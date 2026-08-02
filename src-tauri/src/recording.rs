use crate::audio::levels::{extract_levels, FFT_SIZE};
use crate::audio::capture::resample_linear;
use crate::db;
use crate::paste;
use crate::tray;
use crate::state::{AppState, AudioCommand};
use rustfft::FftPlanner;
use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;
use tauri::{Emitter, Manager};

const WHISPER_SAMPLE_RATE: u32 = 16_000;

/// RMS the ASR models are happiest with (~-20 dBFS). Whispered speech lands
/// two orders of magnitude below this, deep in the log-mel floor.
const TARGET_RMS: f32 = 0.1;
/// Ceiling on the boost, so a near-silent recording turns into quiet noise
/// rather than a wall of amplified room tone.
const MAX_GAIN: f32 = 30.0;
/// Below this RMS there is no speech in the buffer at all — don't amplify it.
const MIN_BOOSTABLE_RMS: f32 = 0.0004;

/// Band level above which normal speech is assumed to be happening.
const SPEECH_THRESHOLD: f32 = 0.005;
/// Floor for whisper mode's adaptive threshold, for rooms quiet enough that
/// three times the noise floor would be below the microphone's own hiss.
const WHISPER_MIN_THRESHOLD: f32 = 0.0003;
/// Frames of `LEVEL_INTERVAL_MS` used to sample the room's noise floor.
const CALIBRATION_FRAMES: u32 = 10;
const LEVEL_INTERVAL_MS: u64 = 33;
/// Whispering barely moves the HUD meter; scale it so the user can still see
/// the app is hearing them.
const HUD_WHISPER_GAIN: f32 = 8.0;

/// RMS of the loudest tenth of the buffer rather than of the whole clip.
/// A whole-clip average is dominated by the pauses and the silence before the
/// first word, which drags the gain up and amplifies room noise instead of the
/// voice. The 90th-percentile frame is the speech.
fn speech_rms(audio: &[f32], frame: usize) -> f32 {
    let frame = frame.max(1);
    let mut frames: Vec<f32> = audio
        .chunks(frame)
        .map(|c| (c.iter().map(|s| s * s).sum::<f32>() / c.len() as f32).sqrt())
        .collect();
    if frames.is_empty() {
        return 0.0;
    }
    frames.sort_by(f32::total_cmp);
    frames[frames.len() * 9 / 10]
}

/// Gain to bring `rms` up to `TARGET_RMS` without pushing `peak` into clipping.
/// Returns 1.0 when the buffer is too quiet to be anything but noise.
fn boost_gain(rms: f32, peak: f32) -> f32 {
    if rms < MIN_BOOSTABLE_RMS || peak <= 0.0 {
        return 1.0;
    }
    let gain = (TARGET_RMS / rms).min(MAX_GAIN);
    if peak * gain > 0.95 {
        (0.95 / peak).max(1.0)
    } else {
        gain.max(1.0)
    }
}

fn play_system_sound(app: &tauri::AppHandle, event_type: &str) {
    let _ = app.emit("play_sound", event_type);
}

/// Moves the HUD window to whichever monitor the cursor is on right now —
/// on multi-monitor setups the pill should appear where you're looking, not
/// always on the monitor it happened to be positioned on at launch.
pub fn reposition_hud_to_cursor(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    let Ok(cursor) = window.cursor_position() else { return };
    let Ok(monitors) = window.available_monitors() else { return };

    let monitor = monitors.into_iter().find(|m| {
        let pos = m.position();
        let size = m.size();
        cursor.x >= pos.x as f64
            && cursor.x < (pos.x + size.width as i32) as f64
            && cursor.y >= pos.y as f64
            && cursor.y < (pos.y + size.height as i32) as f64
    });
    let Some(monitor) = monitor else { return };

    let hud_position = app.state::<AppState>().settings.lock().unwrap().hud_position.clone();
    let size = monitor.size();
    let pos = monitor.position();
    let window_size = window.outer_size().unwrap_or_default();
    let multiplier = match hud_position.as_str() {
        "top" => 0.02,
        _ => 0.90,
    };
    let y = pos.y + (size.height as f64 * multiplier) as i32;
    let x = pos.x + ((size.width as i32) - (window_size.width as i32)) / 2;
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}

pub fn start_recording(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    // Meeting owns the single audio stream; dictation would hijack its buffer.
    if state.is_meeting_recording.load(Ordering::SeqCst) {
        let _ = app.emit("patter://state", "Meeting recording active");
        return;
    }
    println!("🔴 recording...");
    reposition_hud_to_cursor(app);

    // The app in focus now is where the text will land — remember it for
    // per-app cleanup profiles.
    *state.frontmost_app.lock().unwrap() = paste::frontmost_app_name();

    let settings = state.settings.lock().unwrap().clone();
    state.dictation_session_id.fetch_add(1, Ordering::SeqCst);
    if settings.play_sounds {
        play_system_sound(app, "start");
    }

    // Reinitialize the buffer for a new recording
    *state.captured.lock().unwrap() = Vec::new();
    let target = state.captured.clone();

    if state.audio_tx.send(AudioCommand::Start(target, settings.microphone)).is_ok() {
        state.is_recording.store(true, Ordering::SeqCst);
    }

    // If the model got unloaded since the last dictation, start reloading it now
    // rather than at cleanup time — the load then runs under the recording and
    // transcription instead of after them.
    if settings.llm_cleanup_enabled {
        if let Some(model) = settings.ollama_model.clone() {
            crate::ollama::warm_background(model, settings.ollama_keep_alive_minutes);
        }
    }

    let _ = app.emit("patter://state", "Listening...");

    let app_handle = app.clone();
    let is_rec = state.is_recording.clone();
    let captured = state.captured.clone();

    let max_silence_frames = (settings.silence_timeout_ms / LEVEL_INTERVAL_MS as u32).max(15); // min 0.5s
    let whisper_mode = settings.whisper_mode;

    thread::spawn(move || {
        let mut planner = FftPlanner::new();
        let fft = planner.plan_fft_forward(FFT_SIZE);

        let mut speech_detected = false;
        let mut silence_frames = 0;
        // A fixed cutoff never fires for whispered speech, so the silence
        // timeout never arms and recording runs until the hotkey stops it.
        // Whisper mode tracks the actual room instead: the quietest of the
        // first ~330ms is the noise floor, and speech is what rises above it.
        let mut calibration_frames = 0u32;
        let mut noise_floor = f32::MAX;
        let mut threshold = SPEECH_THRESHOLD;

        while is_rec.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(LEVEL_INTERVAL_MS));

            let samples: Vec<f32> = {
                let lock = captured.lock().unwrap();
                let len = lock.len();
                if len >= FFT_SIZE {
                    lock[len - FFT_SIZE..].to_vec()
                } else {
                    let mut pad = vec![0.0; FFT_SIZE - len];
                    pad.extend_from_slice(&lock);
                    pad
                }
            };

            let levels = extract_levels(&fft, &samples);
            let displayed = if whisper_mode {
                levels.map(|l| l * HUD_WHISPER_GAIN)
            } else {
                levels
            };
            let _ = app_handle.emit("levels", displayed);

            // VAD logic: stop recording after 1.5s of silence
            let max_level = levels.iter().cloned().fold(f32::NEG_INFINITY, f32::max);

            if whisper_mode && calibration_frames < CALIBRATION_FRAMES {
                noise_floor = noise_floor.min(max_level);
                calibration_frames += 1;
                if calibration_frames == CALIBRATION_FRAMES {
                    threshold =
                        (noise_floor * 3.0).clamp(WHISPER_MIN_THRESHOLD, SPEECH_THRESHOLD);
                }
            }

            if max_level > threshold {
                speech_detected = true;
                silence_frames = 0;
            } else if speech_detected {
                silence_frames += 1;
                if silence_frames > max_silence_frames {
                    stop_and_transcribe(&app_handle);
                    break;
                }
            }
        }
    });
}

/// True once the session this pipeline belongs to has been superseded — either
/// cancelled or replaced by a newer dictation. Pure check: `cancel` owns
/// bumping the id and emitting idle. Called at the stage boundaries and, during
/// cleanup, once per streamed line.
fn bail_if_cancelled(app: &tauri::AppHandle, session_id: u64) -> bool {
    let state = app.state::<AppState>();
    state.dictation_session_id.load(Ordering::SeqCst) != session_id
}

/// Stops recording and discards the captured buffer without transcribing —
/// distinct from `stop_and_transcribe`, which always runs the ASR pipeline.
pub fn cancel(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    println!("Cancelling recording...");
    
    if state.settings.lock().unwrap().play_sounds {
        play_system_sound(app, "stop");
    }

    if state.is_recording.load(Ordering::SeqCst) {
        state.is_recording.store(false, Ordering::SeqCst);
        let _ = state.audio_tx.send(AudioCommand::Stop);
        state.captured.lock().unwrap().clear();

        let _ = app.emit("levels", [0.0; 5]);
        let _ = app.emit("patter://state", "Idle");
    } else {
        state.dictation_session_id.fetch_add(1, Ordering::SeqCst);
        let _ = app.emit("patter://state", "Idle");
    }
}

pub fn stop_and_transcribe(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    println!("Stopping recording...");
    
    if state.settings.lock().unwrap().play_sounds {
        play_system_sound(app, "stop");
    }

    state.is_recording.store(false, Ordering::SeqCst);
    let _ = state.audio_tx.send(AudioCommand::Stop);

    let _ = app.emit("levels", [0.0; 5]);

    let raw = state.captured.lock().unwrap().clone();
    if raw.is_empty() {
        let _ = app.emit("patter://state", "Idle");
        return;
    }

    let _ = app.emit("patter://state", "Transcribing...");

    let channels = state.device_config.lock().unwrap().channels() as usize;
    let src_rate = state.device_config.lock().unwrap().sample_rate().0;
    let engine_arc = state.engine.clone();
    let app_handle = app.clone();
    let dictation_session_id = state.dictation_session_id.load(Ordering::SeqCst);
    let whisper_mode = state.settings.lock().unwrap().whisper_mode;

    thread::spawn(move || {
        // Everything after the hotkey release, so the stage timings can be read
        // against the number the user actually waits through.
        let pipeline_started = std::time::Instant::now();
        let mono: Vec<f32> = if channels > 1 {
            raw.chunks(channels)
                .map(|frame| {
                    let mut sum = 0.0;
                    for &s in frame {
                        if s.is_finite() {
                            sum += s;
                        }
                    }
                    sum / channels as f32
                })
                .collect()
        } else {
            raw.into_iter().map(|s| if s.is_finite() { s } else { 0.0 }).collect()
        };

        // Normalize if it exceeds 1.0 (some cpal drivers output raw unnormalized integers as f32)
        let max_amp = mono.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        let mono: Vec<f32> = if max_amp > 1.0 {
            println!("Normalizing audio, max amp was {}", max_amp);
            mono.into_iter().map(|s| s / max_amp).collect()
        } else {
            mono
        };

        // The other direction: whispering peaks around 0.02, so the model sees
        // a signal buried in the log-mel floor. Lift it to the level normal
        // speech would have arrived at.
        let mono = if whisper_mode && max_amp <= 1.0 {
            let rms = speech_rms(&mono, src_rate as usize / 50); // 20ms frames
            let gain = boost_gain(rms, max_amp);
            if gain > 1.0 {
                println!("Whisper mode: boosting {:.1}x (rms {:.5})", gain, rms);
                mono.into_iter().map(|s| s * gain).collect()
            } else {
                mono
            }
        } else {
            mono
        };

        let audio = resample_linear(&mono, src_rate, WHISPER_SAMPLE_RATE);

        // Shape the spectrum toward what the models were trained on. Runs before
        // the VAD so Silero sees the cleaned-up signal too.
        let audio = if whisper_mode {
            crate::audio::filter::whisper_tilt(&audio, WHISPER_SAMPLE_RATE)
        } else {
            audio
        };

        if audio.len() < WHISPER_SAMPLE_RATE as usize {
             let _ = app_handle.emit("patter://state", "Audio too short");
             thread::sleep(Duration::from_secs(1));
             let _ = app_handle.emit("patter://state", "Idle");
             return;
        }

        let settings = app_handle.state::<AppState>().settings.lock().unwrap().clone();
        let prompt = settings.custom_prompt;
        let language = settings.language;

        // Silero VAD: strip silence/noise so Whisper never hallucinates on it.
        // Any VAD failure falls back to untrimmed audio — never lose a recording.
        let vad_threshold = if whisper_mode {
            crate::vad::WHISPER_THRESHOLD
        } else {
            crate::vad::DEFAULT_THRESHOLD
        };
        let audio = if settings.trim_silence {
            match crate::vad::ensure_model(&app_handle)
                .and_then(|p| crate::vad::trim_silence(&p, &audio, vad_threshold))
            {
                // Silero scores whispers low even at the lower threshold. Losing
                // the recording is worse than transcribing untrimmed audio, so
                // whisper mode keeps it and lets the model decide.
                Ok(trimmed) if trimmed.is_empty() && whisper_mode => {
                    eprintln!("VAD found no speech, using raw audio (whisper mode)");
                    audio
                }
                Ok(trimmed) if trimmed.is_empty() => {
                    let _ = app_handle.emit("patter://state", "No speech detected");
                    thread::sleep(Duration::from_secs(1));
                    let _ = app_handle.emit("patter://state", "Idle");
                    return;
                }
                Ok(trimmed) => trimmed,
                Err(e) => {
                    eprintln!("VAD failed, using raw audio: {}", e);
                    audio
                }
            }
        } else {
            audio
        };

        if bail_if_cancelled(&app_handle, dictation_session_id) { return; }

        let max_val = audio.iter().cloned().fold(0.0f32, f32::max);
        println!("Audio length: {}, max val: {}", audio.len(), max_val);

        let transcribe_started = std::time::Instant::now();
        let text = {
            let mut lock = engine_arc.lock().unwrap();
            if let Some(engine) = lock.as_mut() {
                engine.set_whisper_mode(whisper_mode);
                match engine.transcribe(&audio, if prompt.is_empty() { None } else { Some(&prompt) }, Some(&language)) {
                    Ok(t) => t,
                    Err(e) => {
                        eprintln!("Inference failed: {}", e);
                        let _ = app_handle.emit("patter://state", "⚠ Transcription failed");
                        thread::sleep(Duration::from_secs(2));
                        let _ = app_handle.emit("patter://state", "Idle");
                        return;
                    }
                }
            } else {
                let _ = app_handle.emit("patter://state", "No model loaded");
                thread::sleep(Duration::from_secs(1));
                let _ = app_handle.emit("patter://state", "Idle");
                return;
            }
        };
        let transcribe_ms = transcribe_started.elapsed().as_millis() as u32;

        if bail_if_cancelled(&app_handle, dictation_session_id) { return; }

        println!("Transcript: {}", text);
        if text.is_empty() {
             let _ = app_handle.emit("patter://state", "Idle");
             return;
        }

        let frontmost = app_handle
            .state::<AppState>()
            .frontmost_app
            .lock()
            .unwrap()
            .clone();
        let profile_prompt = frontmost.as_deref().and_then(|name| {
            let lower = name.to_lowercase();
            settings
                .app_profiles
                .iter()
                .find(|p| {
                    !p.app.is_empty() && p.app.to_lowercase().split(',').map(str::trim).any(|s| !s.is_empty() && lower.contains(s))
                })
                .map(|p| {
                    println!("[cleanup] app profile matched: {} ({})", p.app, name);
                    p.prompt.clone()
                })
        });

        // Stays 0 when cleanup is disabled, which is what the record should say.
        let mut cleanup_ms = 0u32;
        let text = if settings.llm_cleanup_enabled {
            if let Some(model) = settings.ollama_model.as_deref() {
                let _ = app_handle.emit("patter://state", "Cleaning up…");
                
                // RAG: Find relevant memories
                let mut context_prompt = profile_prompt.unwrap_or_default();

                // Whispered speech misrecognizes as phonetically similar words,
                // which is the one kind of error a language model can undo.
                if whisper_mode {
                    if !context_prompt.is_empty() {
                        context_prompt.push_str("\n\n");
                    }
                    context_prompt.push_str(
                        "This transcript came from whispered speech, so some words may be \
                         misheard as similar-sounding ones. Where a word is implausible in \
                         context, replace it with the word it was most likely misheard from. \
                         Do not add content that isn't there.",
                    );
                }
                if !settings.memories.is_empty() {
                    // Embed the current text
                    if let Ok(text_emb) = crate::ollama::get_embedding("nomic-embed-text", &text) {
                        let mut scored_memories: Vec<(&db::MemoryFact, f32)> = settings.memories.iter().filter_map(|m| {
                            if m.embedding.is_empty() || text_emb.len() != m.embedding.len() {
                                None
                            } else {
                                // Cosine similarity
                                let dot: f32 = text_emb.iter().zip(m.embedding.iter()).map(|(a, b)| a * b).sum();
                                let norm_a: f32 = text_emb.iter().map(|a| a * a).sum::<f32>().sqrt();
                                let norm_b: f32 = m.embedding.iter().map(|b| b * b).sum::<f32>().sqrt();
                                let sim = if norm_a > 0.0 && norm_b > 0.0 { dot / (norm_a * norm_b) } else { 0.0 };
                                Some((m, sim))
                            }
                        }).collect();
                        
                        // Sort by similarity descending
                        scored_memories.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
                        
                        // Take top 3 relevant memories with similarity > 0.4
                        let relevant: Vec<String> = scored_memories.into_iter()
                            .filter(|(_, sim)| *sim > 0.4)
                            .take(3)
                            .map(|(m, _)| format!("- {}", m.content))
                            .collect();
                            
                        if !relevant.is_empty() {
                            if !context_prompt.is_empty() {
                                context_prompt.push_str("\n\n");
                            }
                            context_prompt.push_str("Relevant facts from user's memory:\n");
                            context_prompt.push_str(&relevant.join("\n"));
                        }
                    }
                }
                
                let final_extra = if context_prompt.is_empty() { None } else { Some(context_prompt.as_str()) };
                
                // Throttled so a fast model doesn't fire hundreds of IPC events
                // a second at a pill that can only show a couple dozen chars.
                let partial_emitter = app_handle.clone();
                let mut last_partial = std::time::Instant::now();
                let on_partial = |partial: &str| {
                    if last_partial.elapsed() >= Duration::from_millis(60) {
                        last_partial = std::time::Instant::now();
                        let _ = partial_emitter.emit("patter://cleanup_partial", partial);
                    }
                };

                let cleanup_started = std::time::Instant::now();
                let cancel_handle = app_handle.clone();
                let is_cancelled =
                    move || bail_if_cancelled(&cancel_handle, dictation_session_id);

                match crate::ollama::cleanup(
                    model,
                    &text,
                    final_extra,
                    settings.ollama_keep_alive_minutes,
                    on_partial,
                    is_cancelled,
                ) {
                    Ok(cleaned) => {
                        cleanup_ms = cleanup_started.elapsed().as_millis() as u32;
                        println!("Cleaned: {}", cleaned);
                        cleaned
                    }
                    Err(e) if e == crate::ollama::CLEANUP_CANCELLED => {
                        // User pressed cancel; nothing should be pasted or saved.
                        println!("Cleanup cancelled");
                        return;
                    }
                    Err(e) => {
                        // Fall back to the raw transcript rather than dropping it.
                        // Still timed: a cleanup that burns seconds before
                        // failing is exactly what this measurement is for.
                        cleanup_ms = cleanup_started.elapsed().as_millis() as u32;
                        eprintln!("LLM cleanup failed: {}", e);
                        text
                    }
                }
            } else {
                text
            }
        } else {
            text
        };

        if bail_if_cancelled(&app_handle, dictation_session_id) { return; }

        // --- Undo / Scratch That Interception ---
        // --- Undo / Scratch That Interception ---
        let clean_text = text.trim().trim_matches(|c: char| c.is_ascii_punctuation()).to_lowercase();
        if clean_text == "scratch that" || clean_text == "undo that" {
            println!("[undo] Intercepted undo voice command");
            crate::paste::undo();
            let _ = app_handle.emit("patter://hud_state", "idle");
            if settings.play_sounds {
                play_system_sound(&app_handle, "stop");
            }
            return;
        } else if clean_text.ends_with("scratch that") || clean_text.ends_with("undo that") {
            println!("[undo] User aborted dictation mid-sentence");
            let _ = app_handle.emit("patter://hud_state", "idle");
            if settings.play_sounds {
                play_system_sound(&app_handle, "stop");
            }
            return;
        }

        // --- Snippet Expansion ---
        let text = {
            if let Some(snippet) = settings.snippets.iter().find(|s| s.trigger.trim().to_lowercase() == clean_text) {
                println!("[snippet] Expanding macro: {}", snippet.trigger);
                snippet.content.clone()
            } else {
                text
            }
        };

        let total_ms = pipeline_started.elapsed().as_millis() as u32;
        println!(
            "[timing] transcribe={}ms cleanup={}ms total={}ms",
            transcribe_ms, cleanup_ms, total_ms
        );

        let word_count = text.split_whitespace().count();
        let duration_seconds = audio.len() as f32 / WHISPER_SAMPLE_RATE as f32;

        let db = db::Db::new(&app_handle);
        db.add_record(db::TranscriptionRecord {
            id: String::new(),
            timestamp_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
            text: text.clone(),
            duration_seconds,
            words: word_count as u32,
            transcribe_ms,
            cleanup_ms,
            total_ms,
            app_name: frontmost,
            
        });
        let _ = app_handle.emit("patter://db_updated", ());
        tray::refresh(&app_handle);

        let mode = settings.output_mode;

        if paste::accessibility_trusted() {
            let _ = app_handle.emit("patter://state", format!("✓ Pasted · {} words", word_count));
            let _ = app_handle.run_on_main_thread(move || {
                paste::paste_text(&mode, &text);
            });
        } else {
            // Can't synthesize keystrokes without the Accessibility permission;
            // land the text on the clipboard so it isn't lost and tell the UI.
            paste::copy_text(&text);
            let _ = app_handle.emit("patter://accessibility_missing", ());
            let _ = app_handle.emit("patter://state", "⚠ Copied — needs Accessibility");
        }

        thread::sleep(Duration::from_millis(1500));
        let _ = app_handle.emit("patter://state", "Idle");
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boost_gain_lifts_whispers_without_clipping() {
        // Typical whisper into a laptop mic: rms 0.004, peak 0.02.
        let gain = boost_gain(0.004, 0.02);
        assert!(gain > 1.0 && 0.02 * gain <= 0.95, "gain was {gain}");
        assert!((0.004 * gain - TARGET_RMS).abs() < 0.01, "gain was {gain}");

        // A peaky recording is limited by the peak, not the RMS target.
        assert!(boost_gain(0.004, 0.5) * 0.5 <= 0.95);

        // Never boost silence, never attenuate audio that is already loud.
        assert_eq!(boost_gain(0.00001, 0.0001), 1.0);
        assert_eq!(boost_gain(0.0, 0.0), 1.0);
        assert_eq!(boost_gain(0.3, 0.9), 1.0);
    }

    #[test]
    fn speech_rms_ignores_leading_silence() {
        // 9s of near-silence then 1s of whispering: the whisper sets the level,
        // not the average, which would be ~10x lower and over-boost the noise.
        let frame = 960; // 20ms at 48kHz
        let mut audio = vec![0.0001f32; 48_000 * 9];
        audio.extend(std::iter::repeat(0.004).take(48_000));
        let rms = speech_rms(&audio, frame);
        assert!(rms > 0.003, "rms was {rms}");

        let global = (audio.iter().map(|s| s * s).sum::<f32>() / audio.len() as f32).sqrt();
        assert!(boost_gain(rms, 0.02) < boost_gain(global, 0.02));

        assert_eq!(speech_rms(&[], frame), 0.0);
    }
}
