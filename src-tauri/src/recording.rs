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
pub fn speech_rms(audio: &[f32], frame: usize) -> f32 {
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
pub fn boost_gain(rms: f32, peak: f32) -> f32 {
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

/// Command mode: grab whatever the user has selected in the app they're in,
/// then record the instruction to rewrite it with. The selection is read before
/// recording starts because the copy is a synthetic ⌘C into the target app —
/// doing it later would race the user's own typing.
pub fn start_command(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    if state.is_recording.load(Ordering::SeqCst)
        || state.is_meeting_recording.load(Ordering::SeqCst)
    {
        return;
    }
    if !paste::accessibility_trusted() {
        let _ = app.emit("patter://accessibility_missing", ());
        let _ = app.emit("patter://state", "⚠ Command needs Accessibility");
        return;
    }
    drop(state);

    // Off the caller's thread before anything blocks. Hotkeys arrive on rdev's
    // macOS event tap, and a callback that stalls there gets the tap disabled
    // by the OS — reading the selection sleeps for up to 400ms.
    let app = app.clone();
    thread::spawn(move || {
        // ponytail: a modifier the user is still physically holding turns this
        // synthetic ⌘C into ⌘⌥C and the selection comes back empty. Nothing
        // enigo exposes can clear a held physical key, so command mode wants a
        // plain key; the UI refuses bare-modifier bindings for this reason.
        let selection = paste::read_selection(&app);
        let has_selection = selection.is_some();

        start_recording(&app);

        let state = app.state::<AppState>();
        if !state.is_recording.load(Ordering::SeqCst) {
            return;
        }
        // Set after `start_recording`, which clears it.
        *state.command_selection.lock().unwrap() = Some(selection.unwrap_or_default());
        let _ = app.emit(
            "patter://state",
            if has_selection { "Command…" } else { "Command (no selection)…" },
        );
    });
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
    // A plain dictation must never inherit a selection left behind by a command
    // that was cancelled or never transcribed. `start_command` re-sets it after.
    *state.command_selection.lock().unwrap() = None;

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
        // Cloned, not moved: the dictionary is used twice — here as the ASR
        // initial prompt, and again in the cleanup context for the engines that
        // ignore that prompt.
        let prompt = settings.custom_prompt.clone();
        let language = settings.language.clone();

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

        // Engine-independent, so the dictionary works on Parakeet (which drops
        // the initial prompt) and with cleanup off. Runs before cleanup, not
        // instead of it: the LLM still gets the terms, and fixing the spelling
        // first gives it a transcript it can reason about.
        let text = crate::dictionary::apply(&text, &settings.custom_prompt);

        if bail_if_cancelled(&app_handle, dictation_session_id) { return; }

        println!("Transcript: {}", text);
        if text.is_empty() {
             let _ = app_handle.emit("patter://state", "Idle");
             return;
        }

        // Command mode diverges here: the transcript is an instruction about
        // the user's selection, not text to paste. Taken (not read) so a failed
        // command can't leave the next dictation in command mode.
        let command_selection = app_handle
            .state::<AppState>()
            .command_selection
            .lock()
            .unwrap()
            .take();
        if let Some(selection) = command_selection {
            run_command(
                &app_handle,
                settings.ollama_model.as_deref(),
                settings.ollama_keep_alive_minutes,
                &selection,
                &text,
                dictation_session_id,
            );
            return;
        }

        // Spoken trigger: same thing without a second hotkey. Checked here,
        // before cleanup, because the cleanup model reads a leading "Patter,"
        // as an address and strips it.
        //
        // The selection is read now rather than at record start — there was no
        // way to know this was a command until the words arrived. In practice
        // the user held a hotkey and spoke, so the selection they made is still
        // the selection. With nothing selected this is not a command at all:
        // fall through and dictate the words as spoken, which is the only
        // outcome that can't destroy anything.
        if let Some(instruction) = command_phrase_instruction(&text, &settings.command_phrase) {
            if let Some(selection) = paste::read_selection(&app_handle) {
                run_command(
                    &app_handle,
                    settings.ollama_model.as_deref(),
                    settings.ollama_keep_alive_minutes,
                    &selection,
                    instruction,
                    dictation_session_id,
                );
                return;
            }
            println!("[command] phrase matched but nothing selected — dictating instead");
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

                // The dictionary also goes to the ASR engine as an initial
                // prompt, but only Whisper honours that — Parakeet ignores the
                // argument outright, which left the whole feature dead on it.
                // Cleanup is the one stage every engine shares.
                if !settings.custom_prompt.trim().is_empty() {
                    if !context_prompt.is_empty() {
                        context_prompt.push_str("\n\n");
                    }
                    context_prompt.push_str(
                        "The user's custom vocabulary — names, acronyms and jargon the speech \
                         model is likely to get wrong:\n",
                    );
                    context_prompt.push_str(&settings.custom_prompt);
                    context_prompt.push_str(
                        "\n\nWhen a word or phrase in the transcript is a near-homophone of one \
                         of these terms, it is almost certainly that term — replace it, and \
                         match the spelling and casing given above exactly. Never insert a term \
                         that nothing in the transcript sounds like.",
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

        // After cleanup, so it catches both the model's period and the engine's.
        let text = strip_fragment_period(&text).to_string();

        // --- Undo / Scratch That Interception ---
        // --- Undo / Scratch That Interception ---
        let clean_text = text.trim().trim_matches(|c: char| c.is_ascii_punctuation()).to_lowercase();
        if clean_text == "scratch that" || clean_text == "undo that" {
            println!("[undo] Intercepted undo voice command");
            crate::paste::undo(&app_handle);
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
            // Only an edit creates one; a fresh record has nothing to preserve.
            original_text: None,
        });
        let _ = app_handle.emit("patter://db_updated", ());
        tray::refresh(&app_handle);

        let mode = settings.output_mode;

        if paste::accessibility_trusted() {
            let _ = app_handle.emit("patter://state", format!("✓ Pasted · {} words", word_count));
            paste::paste_text(&app_handle, &mode, &text);
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

/// How closely the spoken trigger has to match the configured phrase. One edit
/// in a short folded word, which is what a mangled trigger costs — "patter"
/// comes back as "padder" often enough that a stricter bar means the trigger
/// mostly doesn't fire, and a trigger that mostly doesn't fire is worse than no
/// trigger.
///
/// The cost is that a near-homophone of the trigger can fire it, so a
/// distinctive phrase is worth choosing. Two things bound the damage: it only
/// counts at the very start of a transcript, and with nothing selected it falls
/// through to ordinary dictation.
const COMMAND_PHRASE_SIMILARITY: f32 = 0.8;

/// The instruction inside a spoken command, or `None` when this transcript is
/// ordinary dictation.
///
/// The phrase only counts as a trigger at the very start. Anywhere else it is
/// someone saying the word — "the command phrase is patter" must dictate, not
/// execute. Matching is phonetic for the same reason the dictionary is: the
/// engine mangles trigger words, and a trigger that only fires on a perfect
/// transcription fires rarely.
///
/// Must run BEFORE cleanup. The cleanup model treats a leading "Patter," as an
/// address and strips it as filler, so by then the evidence is gone.
fn command_phrase_instruction<'a>(text: &'a str, phrase: &str) -> Option<&'a str> {
    let phrase = phrase.trim();
    if phrase.is_empty() {
        return None;
    }
    let phrase_words = phrase.split_whitespace().count();

    // Whitespace-delimited words with their offsets, only as many as the phrase
    // needs. `split_whitespace` would be simpler but drops the offsets, and the
    // instruction is whatever follows the matched span.
    let mut words: Vec<(usize, &str)> = Vec::new();
    let mut word_start: Option<usize> = None;
    for (i, c) in text.char_indices() {
        if c.is_whitespace() {
            if let Some(begin) = word_start.take() {
                words.push((begin, &text[begin..i]));
                if words.len() == phrase_words {
                    break;
                }
            }
        } else if word_start.is_none() {
            word_start = Some(i);
        }
    }
    if words.len() < phrase_words {
        if let Some(begin) = word_start {
            words.push((begin, &text[begin..]));
        }
    }

    let spoken = words
        .iter()
        .map(|(_, word)| *word)
        .collect::<Vec<_>>()
        .join(" ");
    let end = words.last().map_or(0, |(offset, word)| offset + word.len());

    if spoken.is_empty()
        || crate::dictionary::phonetic_similarity(&spoken, phrase) < COMMAND_PHRASE_SIMILARITY
    {
        return None;
    }

    let instruction = text[end..]
        .trim_start_matches(|c: char| c.is_whitespace() || c == ',' || c == ':' || c == '.')
        .trim();
    if instruction.is_empty() {
        return None;
    }
    Some(instruction)
}

/// Whisper, Parakeet and the cleanup model all terminate an utterance with a
/// period. That is right for a sentence and wrong for the single word someone
/// dictates into a search box, a filename field or a chat message — and the
/// prompt rule alone can't cover the cleanup-off path, where no model is
/// looking at the text at all.
///
/// Only a one-word transcript is touched. Anything longer might genuinely be a
/// sentence, and there is no cheap way to tell a fragment from one; guessing
/// there would cost more than it saves. `?` and `!` are always deliberate, and
/// a word carrying its own period ("etc.", "v1.2.") keeps it.
fn strip_fragment_period(text: &str) -> &str {
    /// One-word abbreviations whose period is part of the word, so they look
    /// exactly like the case being stripped and can only be listed.
    const ABBREVIATIONS: &[&str] = &[
        "etc", "vs", "approx", "dr", "mr", "mrs", "ms", "prof", "inc", "ltd",
        "co", "jr", "sr", "st", "no", "vol", "fig", "al",
    ];

    let trimmed = text.trim_end();
    let Some(stem) = trimmed.strip_suffix('.') else {
        return text;
    };
    if stem.is_empty() || stem.contains(char::is_whitespace) || stem.contains('.') {
        return text;
    }
    if ABBREVIATIONS.contains(&stem.to_lowercase().as_str()) {
        return text;
    }
    stem
}

/// Rewrite `selection` per the spoken `instruction` and paste the result over
/// it. Failure pastes nothing: the selection is still highlighted, so pasting
/// an error — or the raw instruction — would destroy the user's text. That is
/// the opposite of dictation's fallback, and deliberately so.
fn run_command(
    app: &tauri::AppHandle,
    ollama_model: Option<&str>,
    keep_alive_minutes: i32,
    selection: &str,
    instruction: &str,
    session_id: u64,
) {
    let Some(model) = ollama_model.filter(|m| !m.is_empty()) else {
        let _ = app.emit("patter://state", "⚠ Command needs an Ollama model");
        thread::sleep(Duration::from_millis(2000));
        let _ = app.emit("patter://state", "Idle");
        return;
    };

    let _ = app.emit("patter://state", "Rewriting…");

    let partial_emitter = app.clone();
    let mut last_partial = std::time::Instant::now();
    let on_partial = |partial: &str| {
        if last_partial.elapsed() >= Duration::from_millis(60) {
            last_partial = std::time::Instant::now();
            let _ = partial_emitter.emit("patter://cleanup_partial", partial);
        }
    };
    let cancel_handle = app.clone();
    let is_cancelled = move || bail_if_cancelled(&cancel_handle, session_id);

    let result = match crate::ollama::command(
        model,
        selection,
        instruction,
        keep_alive_minutes,
        on_partial,
        is_cancelled,
    ) {
        Ok(result) => result,
        Err(e) if e == crate::ollama::CLEANUP_CANCELLED => return,
        Err(e) => {
            eprintln!("Command failed: {}", e);
            let _ = app.emit("patter://state", "⚠ Command failed");
            thread::sleep(Duration::from_millis(2000));
            let _ = app.emit("patter://state", "Idle");
            return;
        }
    };

    if bail_if_cancelled(app, session_id) {
        return;
    }

    println!("[command] instruction={} result_chars={}", instruction, result.len());

    // Always the paste path, never `type`: replacing a selection keystroke by
    // keystroke means the first character overwrites it and every character
    // after lands in a field the app may have already reformatted.
    let _ = app.emit("patter://state", "✓ Rewritten");
    paste::paste_text(app, "paste", &result);

    thread::sleep(Duration::from_millis(1500));
    let _ = app.emit("patter://state", "Idle");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spoken_trigger_fires_only_at_the_start() {
        assert_eq!(
            command_phrase_instruction("Patter, make this formal", "patter"),
            Some("make this formal")
        );
        // The engine mangles trigger words; phonetic matching is the point.
        assert_eq!(
            command_phrase_instruction("Padder make this formal", "patter"),
            Some("make this formal")
        );
        assert_eq!(
            command_phrase_instruction("Patter: turn this into bullets", "patter"),
            Some("turn this into bullets")
        );

        // Anywhere but the start, it is someone saying the word.
        assert_eq!(
            command_phrase_instruction("the command phrase is patter", "patter"),
            None
        );
        // An unrelated first word never triggers.
        assert_eq!(command_phrase_instruction("send this to Tom", "patter"), None);
        // Trigger with nothing after it is not an instruction.
        assert_eq!(command_phrase_instruction("Patter", "patter"), None);
        assert_eq!(command_phrase_instruction("Patter.", "patter"), None);
        // Off by default: an empty phrase can never match.
        assert_eq!(command_phrase_instruction("anything at all", ""), None);
        assert_eq!(command_phrase_instruction("", "patter"), None);
    }

    #[test]
    fn spoken_trigger_handles_multi_word_phrases() {
        assert_eq!(
            command_phrase_instruction("hey patter make this formal", "hey patter"),
            Some("make this formal")
        );
        // Only the first word of a two-word phrase is not a match.
        assert_eq!(command_phrase_instruction("hey there", "hey patter"), None);
    }

    #[test]
    fn strips_the_period_only_from_one_word_transcripts() {
        // The reported case: a single word dictated into a field.
        assert_eq!(strip_fragment_period("iPhone."), "iPhone");
        assert_eq!(strip_fragment_period("Kubernetes."), "Kubernetes");
        assert_eq!(strip_fragment_period("iPhone.  "), "iPhone");

        // A sentence keeps its period — a fragment can't be told from a
        // sentence once there is more than one word in it.
        assert_eq!(strip_fragment_period("Ship it."), "Ship it.");
        assert_eq!(strip_fragment_period("This is really bad."), "This is really bad.");

        // Deliberate marks, and words that carry their own period.
        assert_eq!(strip_fragment_period("Ready?"), "Ready?");
        assert_eq!(strip_fragment_period("Stop!"), "Stop!");
        assert_eq!(strip_fragment_period("etc."), "etc.");
        assert_eq!(strip_fragment_period("v1.2."), "v1.2.");
        assert_eq!(strip_fragment_period("src/main.rs"), "src/main.rs");

        // Nothing to strip.
        assert_eq!(strip_fragment_period("iPhone"), "iPhone");
        assert_eq!(strip_fragment_period(""), "");
        assert_eq!(strip_fragment_period("."), ".");
    }

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
