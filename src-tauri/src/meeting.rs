use crate::audio::capture::resample_linear;
use crate::db;
use crate::state::{AppState, AudioCommand};
use std::sync::atomic::Ordering;
use std::thread;
use tauri::{Emitter, Manager};

const WHISPER_SAMPLE_RATE: u32 = 16_000;

// ponytail: whole meeting buffered raw in RAM (~1.4GB/hr at 48kHz stereo).
// Downsample in the capture callback if multi-hour meetings become a real use case.

pub fn start_meeting(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();

    if state.is_recording.load(Ordering::SeqCst) {
        return Err("Dictation in progress — stop it first".to_string());
    }
    if state.is_meeting_recording.load(Ordering::SeqCst) {
        return Err("Meeting recording already in progress".to_string());
    }

    let settings = state.settings.lock().unwrap().clone();
    *state.meeting_captured.lock().unwrap() = Vec::new();

    if state
        .audio_tx
        .send(AudioCommand::Start(state.meeting_captured.clone(), settings.microphone))
        .is_err()
    {
        return Err("Audio thread unavailable".to_string());
    }
    state.is_meeting_recording.store(true, Ordering::SeqCst);
    let _ = app.emit("patter://meeting_state", "recording");
    crate::tray::refresh(app);
    Ok(())
}

pub fn stop_meeting(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();

    if !state.is_meeting_recording.load(Ordering::SeqCst) {
        return Err("No meeting recording in progress".to_string());
    }
    state.is_meeting_recording.store(false, Ordering::SeqCst);
    let _ = state.audio_tx.send(AudioCommand::Stop);
    crate::tray::refresh(app);

    let raw = std::mem::take(&mut *state.meeting_captured.lock().unwrap());
    if raw.is_empty() {
        let _ = app.emit("patter://meeting_state", "idle");
        return Err("No audio captured".to_string());
    }

    let channels = state.device_config.lock().unwrap().channels() as usize;
    let src_rate = state.device_config.lock().unwrap().sample_rate().0;
    let engine_arc = state.engine.clone();
    let app_handle = app.clone();

    thread::spawn(move || {
        let _ = app_handle.emit("patter://meeting_state", "transcribing");

        let mono: Vec<f32> = if channels > 1 {
            raw.chunks(channels)
                .map(|frame| frame.iter().sum::<f32>() / channels as f32)
                .collect()
        } else {
            raw
        };
        let audio = resample_linear(&mono, src_rate, WHISPER_SAMPLE_RATE);
        let duration_seconds = audio.len() as f32 / WHISPER_SAMPLE_RATE as f32;

        if audio.len() < WHISPER_SAMPLE_RATE as usize {
            let _ = app_handle.emit("patter://meeting_state", "error: audio too short");
            return;
        }

        let settings = app_handle.state::<AppState>().settings.lock().unwrap().clone();
        let language = settings.language;

        // Strip silence/noise before ASR — see recording.rs; failure = use raw audio.
        let audio = if settings.trim_silence {
            match crate::vad::ensure_model(&app_handle)
                .and_then(|p| crate::vad::trim_silence(&p, &audio))
            {
                Ok(trimmed) if trimmed.is_empty() => {
                    let _ = app_handle.emit("patter://meeting_state", "error: no speech detected");
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

        let transcript = {
            let mut lock = engine_arc.lock().unwrap();
            if let Some(engine) = lock.as_mut() {
                // Speaker labels: diarize + per-segment transcription. Any
                // diarization failure falls back to plain transcription.
                let diarized = if settings.diarize_meetings
                    && crate::diarize::models_downloaded(&app_handle)
                {
                    match crate::diarize::diarize_and_transcribe(&app_handle, engine, &audio, &language) {
                        Ok(t) => Some(t),
                        Err(e) => {
                            eprintln!("[diarize] failed, plain transcription: {}", e);
                            None
                        }
                    }
                } else {
                    None
                };
                match diarized {
                    Some(t) => t,
                    None => match engine.transcribe(&audio, None, Some(&language)) {
                        Ok(t) => t,
                        Err(e) => {
                            eprintln!("Meeting transcription failed: {}", e);
                            let _ = app_handle.emit("patter://meeting_state", "error: transcription failed");
                            return;
                        }
                    },
                }
            } else {
                let _ = app_handle.emit("patter://meeting_state", "error: no model loaded");
                return;
            }
        };

        if transcript.is_empty() {
            let _ = app_handle.emit("patter://meeting_state", "error: empty transcript");
            return;
        }

        // Analysis is best-effort: no Ollama model → save transcript-only record.
        // Meetings can use their own model; falls back to the cleanup model.
        let meeting_model = settings.meeting_ollama_model.or(settings.ollama_model);
        let analysis = if let Some(model) = meeting_model.as_deref() {
            let _ = app_handle.emit("patter://meeting_state", "summarizing");
            match crate::ollama::summarize_meeting(model, &transcript) {
                Ok(a) => a,
                Err(e) => {
                    eprintln!("Meeting analysis failed: {}", e);
                    // Transcript-only record still gets saved below; tell the UI why
                    // there's no summary.
                    let _ = app_handle.emit(
                        "patter://meeting_state",
                        format!("error: summary failed ({}) — transcript saved", e),
                    );
                    Default::default()
                }
            }
        } else {
            Default::default()
        };

        let timestamp_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let title = if analysis.title.is_empty() {
            format!("Meeting · {} min", (duration_seconds / 60.0).ceil() as u32)
        } else {
            analysis.title
        };

        db::Db::new(&app_handle).add_meeting(db::MeetingRecord {
            id: String::new(),
            timestamp_ms,
            title,
            duration_seconds,
            transcript,
            summary: analysis.summary,
            minutes: analysis.minutes,
            decisions: analysis.decisions,
            action_items: analysis.action_items,
        });

        let _ = app_handle.emit("patter://meetings_updated", ());
        let _ = app_handle.emit("patter://meeting_state", "idle");
    });

    Ok(())
}
