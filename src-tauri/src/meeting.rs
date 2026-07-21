use crate::audio::capture::resample_linear;
use crate::db;
use crate::state::{AppState, AudioCommand};
use std::io::Write;
use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;
use tauri::{Emitter, Manager};

const WHISPER_SAMPLE_RATE: u32 = 16_000;

fn buffer_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.path()
        .app_data_dir()
        .expect("no app data dir")
        .join("meeting_buffer.f32")
}

/// Move whatever raw audio has accumulated to the on-disk 16 kHz mono buffer
/// (f32-le, ~115 MB/hr on disk, flat RAM). The whole move happens under the
/// file lock so concurrent drains can't interleave chunks out of order.
/// ponytail: per-chunk linear resampling leaves a one-sample seam every
/// drain; inaudible to ASR at 16 kHz.
fn drain_captured(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let channels = (state.device_config.lock().unwrap().channels() as usize).max(1);
    let src_rate = state.device_config.lock().unwrap().sample_rate().0;

    let mut file_lock = state.meeting_file.lock().unwrap();
    let Some(file) = file_lock.as_mut() else {
        return;
    };
    let chunk: Vec<f32> = {
        let mut raw = state.meeting_captured.lock().unwrap();
        let take = raw.len() - raw.len() % channels;
        if take == 0 {
            return;
        }
        raw.drain(..take).collect()
    };
    let mono: Vec<f32> = if channels > 1 {
        chunk
            .chunks(channels)
            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
            .collect()
    } else {
        chunk
    };
    let bytes: Vec<u8> = resample_linear(&mono, src_rate, WHISPER_SAMPLE_RATE)
        .iter()
        .flat_map(|s| s.to_le_bytes())
        .collect();
    if let Err(e) = file.write_all(&bytes) {
        eprintln!("meeting buffer write failed: {}", e);
    }
}

pub fn start_meeting(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();

    if state.is_recording.load(Ordering::SeqCst) {
        return Err("Dictation in progress — stop it first".to_string());
    }
    if state.is_meeting_recording.load(Ordering::SeqCst) {
        return Err("Meeting recording already in progress".to_string());
    }

    crate::recording::reposition_hud_to_cursor(app);

    let settings = state.settings.lock().unwrap().clone();
    state.meeting_cancelled.store(false, Ordering::SeqCst);
    *state.meeting_captured.lock().unwrap() = Vec::new();
    let path = buffer_path(app);
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let file = std::fs::File::create(&path)
        .map_err(|e| format!("Cannot create meeting buffer file: {}", e))?;
    *state.meeting_file.lock().unwrap() = Some(file);

    if state
        .audio_tx
        .send(AudioCommand::Start(state.meeting_captured.clone(), settings.microphone))
        .is_err()
    {
        return Err("Audio thread unavailable".to_string());
    }
    state.is_meeting_recording.store(true, Ordering::SeqCst);

    // Compact the raw buffer every couple of seconds for the whole recording.
    let app_handle = app.clone();
    thread::spawn(move || {
        while app_handle
            .state::<AppState>()
            .is_meeting_recording
            .load(Ordering::SeqCst)
        {
            thread::sleep(Duration::from_secs(2));
            drain_captured(&app_handle);
        }
    });

    let _ = app.emit("patter://meeting_state", "recording");
    crate::tray::refresh(app);
    Ok(())
}

/// Cancels a meeting in progress: while still capturing, discards the buffer
/// immediately (no transcription); once stopped, flags the running pipeline
/// to bail at its next checkpoint instead of saving.
pub fn cancel_meeting(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();

    if state.is_meeting_recording.load(Ordering::SeqCst) {
        state.is_meeting_recording.store(false, Ordering::SeqCst);
        let _ = state.audio_tx.send(AudioCommand::Stop);
        *state.meeting_file.lock().unwrap() = None;
        *state.meeting_captured.lock().unwrap() = Vec::new();
        let _ = std::fs::remove_file(buffer_path(app));
        crate::tray::refresh(app);
        let _ = app.emit("patter://meeting_state", "idle");
        return Ok(());
    }

    state.meeting_cancelled.store(true, Ordering::SeqCst);
    Ok(())
}

/// Checks the cancellation flag; if set, resets it, emits idle, and returns
/// true so the caller can bail out of the pipeline without saving.
fn bail_if_cancelled(app: &tauri::AppHandle) -> bool {
    let state = app.state::<AppState>();
    if state.meeting_cancelled.swap(false, Ordering::SeqCst) {
        let _ = app.emit("patter://meeting_state", "idle");
        true
    } else {
        false
    }
}

pub fn stop_meeting(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();

    if !state.is_meeting_recording.load(Ordering::SeqCst) {
        return Err("No meeting recording in progress".to_string());
    }
    state.is_meeting_recording.store(false, Ordering::SeqCst);
    let _ = state.audio_tx.send(AudioCommand::Stop);
    crate::tray::refresh(app);

    // Final drain of whatever the loop hasn't picked up yet, then close the
    // buffer file and read it back for transcription.
    drain_captured(app);
    *state.meeting_file.lock().unwrap() = None;
    *state.meeting_captured.lock().unwrap() = Vec::new();
    let path = buffer_path(app);
    let bytes = std::fs::read(&path).unwrap_or_default();
    let _ = std::fs::remove_file(&path);
    let audio: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
        .collect();
    if audio.is_empty() {
        let _ = app.emit("patter://meeting_state", "idle");
        return Err("No audio captured".to_string());
    }

    let engine_arc = state.engine.clone();
    let app_handle = app.clone();

    thread::spawn(move || {
        let _ = app_handle.emit("patter://meeting_state", "transcribing");

        let duration_seconds = audio.len() as f32 / WHISPER_SAMPLE_RATE as f32;
        if audio.len() < WHISPER_SAMPLE_RATE as usize {
            let _ = app_handle.emit("patter://meeting_state", "error: audio too short");
            return;
        }

        let settings = app_handle.state::<AppState>().settings.lock().unwrap().clone();
        let language = settings.language;

        if bail_if_cancelled(&app_handle) {
            return;
        }

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

        if bail_if_cancelled(&app_handle) {
            return;
        }

        // Speaker labels: diarize + per-segment transcription. The engine lock
        // is taken per segment inside diarize_and_transcribe, so an hour-long
        // job doesn't freeze dictation. Any diarization failure falls back to
        // plain transcription.
        let diarized = if settings.diarize_meetings && crate::diarize::models_downloaded(&app_handle)
        {
            match crate::diarize::diarize_and_transcribe(&app_handle, &engine_arc, &audio, &language)
            {
                Ok(t) => Some(t),
                Err(e) => {
                    eprintln!("[diarize] failed, plain transcription: {}", e);
                    None
                }
            }
        } else {
            None
        };
        let transcript = match diarized {
            Some(t) => t,
            None => {
                let mut lock = engine_arc.lock().unwrap();
                match lock.as_mut() {
                    Some(engine) => match engine.transcribe(&audio, None, Some(&language)) {
                        Ok(t) => t,
                        Err(e) => {
                            eprintln!("Meeting transcription failed: {}", e);
                            let _ = app_handle
                                .emit("patter://meeting_state", "error: transcription failed");
                            return;
                        }
                    },
                    None => {
                        let _ = app_handle.emit("patter://meeting_state", "error: no model loaded");
                        return;
                    }
                }
            }
        };
        let _ = app_handle.emit("patter://meeting_progress", "");

        if transcript.is_empty() {
            let _ = app_handle.emit("patter://meeting_state", "error: empty transcript");
            return;
        }

        if bail_if_cancelled(&app_handle) {
            return;
        }

        // Analysis is best-effort: no Ollama model → save transcript-only record.
        // Meetings can use their own model; falls back to the cleanup model.
        let meeting_model = settings.meeting_ollama_model.or(settings.ollama_model);
        let analysis = if let Some(model) = meeting_model.as_deref() {
            let _ = app_handle.emit("patter://meeting_state", "summarizing");
            match crate::ollama::summarize_meeting(model, &transcript, |current, total| {
                if total > 1 {
                    if current < total {
                        let _ = app_handle.emit("patter://meeting_state", format!("summarizing (part {}/{})", current, total - 1));
                    } else {
                        let _ = app_handle.emit("patter://meeting_state", "synthesizing final summary".to_string());
                    }
                }
            }) {
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

        if bail_if_cancelled(&app_handle) {
            return;
        }

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
