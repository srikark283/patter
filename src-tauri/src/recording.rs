use crate::audio::levels::{extract_levels, FFT_SIZE};
use crate::audio::capture::resample_linear;
use crate::db;
use crate::paste;
use crate::state::{AppState, AudioCommand};
use rustfft::FftPlanner;
use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;
use tauri::{Emitter, Manager};

const WHISPER_SAMPLE_RATE: u32 = 16_000;

fn play_system_sound(sound_name: &str, rate: f32) {
    let path = format!("/System/Library/Sounds/{}", sound_name);
    let rate_str = rate.to_string();
    thread::spawn(move || {
        let _ = std::process::Command::new("afplay")
            .arg("-r")
            .arg(&rate_str)
            .arg(&path)
            .output();
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
    
    let settings = state.settings.lock().unwrap().clone();
    if settings.play_sounds {
        play_system_sound("Pop.aiff", 1.5);
    }

    // Reinitialize the buffer for a new recording
    *state.captured.lock().unwrap() = Vec::new();
    let target = state.captured.clone();

    if state.audio_tx.send(AudioCommand::Start(target, settings.microphone)).is_ok() {
        state.is_recording.store(true, Ordering::SeqCst);
    }
    
    let _ = app.emit("patter://state", "Listening...");

    let app_handle = app.clone();
    let is_rec = state.is_recording.clone();
    let captured = state.captured.clone();

    let max_silence_frames = (settings.silence_timeout_ms / 33).max(15); // min 0.5s

    thread::spawn(move || {
        let mut planner = FftPlanner::new();
        let fft = planner.plan_fft_forward(FFT_SIZE);

        let mut speech_detected = false;
        let mut silence_frames = 0;

        while is_rec.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(33));

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
            let _ = app_handle.emit("levels", levels);

            // VAD logic: stop recording after 1.5s of silence
            let max_level = levels.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
            if max_level > 0.015 {
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

/// Stops recording and discards the captured buffer without transcribing —
/// distinct from `stop_and_transcribe`, which always runs the ASR pipeline.
pub fn cancel(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    println!("Cancelling recording...");
    
    if state.settings.lock().unwrap().play_sounds {
        play_system_sound("Pop.aiff", 0.9);
    }

    state.is_recording.store(false, Ordering::SeqCst);
    let _ = state.audio_tx.send(AudioCommand::Stop);
    state.captured.lock().unwrap().clear();

    let _ = app.emit("levels", [0.0; 5]);
    let _ = app.emit("patter://state", "Idle");
}

pub fn stop_and_transcribe(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    println!("Stopping recording...");
    
    if state.settings.lock().unwrap().play_sounds {
        play_system_sound("Pop.aiff", 0.9);
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

    thread::spawn(move || {
        let mono: Vec<f32> = if channels > 1 {
            raw.chunks(channels)
                .map(|frame| frame.iter().sum::<f32>() / channels as f32)
                .collect()
        } else {
            raw
        };
        let audio = resample_linear(&mono, src_rate, WHISPER_SAMPLE_RATE);

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
        let audio = if settings.trim_silence {
            match crate::vad::ensure_model(&app_handle)
                .and_then(|p| crate::vad::trim_silence(&p, &audio))
            {
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

        let transcribe_started = std::time::Instant::now();
        let text = {
            let mut lock = engine_arc.lock().unwrap();
            if let Some(engine) = lock.as_mut() {
                match engine.transcribe(&audio, if prompt.is_empty() { None } else { Some(&prompt) }, Some(&language)) {
                    Ok(t) => t,
                    Err(e) => {
                        eprintln!("Inference failed: {}", e);
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

        println!("Transcript: {}", text);
        if text.is_empty() {
             let _ = app_handle.emit("patter://state", "Idle");
             return;
        }

        let text = if settings.llm_cleanup_enabled {
            if let Some(model) = settings.ollama_model.as_deref() {
                let _ = app_handle.emit("patter://state", "Cleaning up…");
                match crate::ollama::cleanup(model, &text) {
                    Ok(cleaned) => {
                        println!("Cleaned: {}", cleaned);
                        cleaned
                    }
                    Err(e) => {
                        // Fall back to the raw transcript rather than dropping it.
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
        });
        let _ = app_handle.emit("patter://db_updated", ());

        let _ = app_handle.emit("patter://state", format!("✓ Pasted · {} words", word_count));

        let mode = settings.output_mode;

        let _ = app_handle.run_on_main_thread(move || {
            paste::paste_text(&mode, &text);
        });

        thread::sleep(Duration::from_millis(1500));
        let _ = app_handle.emit("patter://state", "Idle");
    });
}
