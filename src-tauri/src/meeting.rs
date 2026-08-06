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

/// Meeting audio skips the dictation preprocessing in `recording.rs` — it comes
/// straight off the drain loop. Two things still have to happen: some cpal
/// drivers hand back unnormalized integers as f32, and room audio across a
/// table sits an order of magnitude below dictation into a close mic, deep in
/// the log-mel floor. Both wreck ASR *and* the speaker embeddings diarization
/// clusters on.
fn normalize_for_asr(audio: Vec<f32>) -> Vec<f32> {
    let mut audio: Vec<f32> = audio
        .into_iter()
        .map(|s| if s.is_finite() { s } else { 0.0 })
        .collect();
    let peak = audio.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
    if peak > 1.0 {
        println!("[meeting] normalizing, peak was {}", peak);
        for s in audio.iter_mut() {
            *s /= peak;
        }
        return audio;
    }
    // 20ms frames, same as dictation.
    let rms = crate::recording::speech_rms(&audio, WHISPER_SAMPLE_RATE as usize / 50);
    let gain = crate::recording::boost_gain(rms, peak);
    if gain > 1.0 {
        println!("[meeting] boosting {:.1}x (rms {:.5})", gain, rms);
        for s in audio.iter_mut() {
            *s *= gain;
        }
    }
    audio
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
    state.meeting_session_id.fetch_add(1, Ordering::SeqCst);
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
    let start_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    state.meeting_start_ms.store(start_ms, Ordering::SeqCst);

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

    state.meeting_session_id.fetch_add(1, Ordering::SeqCst);
    let _ = app.emit("patter://meeting_state", "idle");
    Ok(())
}

/// Checks the cancellation flag; if set, resets it, emits idle, and returns
/// true so the caller can bail out of the pipeline without saving.
fn bail_if_cancelled(app: &tauri::AppHandle, session_id: u64) -> bool {
    let state = app.state::<AppState>();
    state.meeting_session_id.load(Ordering::SeqCst) != session_id
}

pub fn stop_meeting(app: &tauri::AppHandle, num_speakers: Option<i32>) -> Result<(), String> {
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

    let meeting_session_id = state.meeting_session_id.load(Ordering::SeqCst);
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

        if bail_if_cancelled(&app_handle, meeting_session_id) {
            return;
        }

        // No VAD here, unlike dictation. `trim_silence` deletes silence rather
        // than muting it and splices the speech back together, which destroys
        // the timeline the diarizer's timestamps are reported against and takes
        // the turn-taking gaps pyannote segments on with it.
        let audio = normalize_for_asr(audio);

        if bail_if_cancelled(&app_handle, meeting_session_id) {
            return;
        }

        // Speaker labels: diarize + per-segment transcription. The engine lock
        // is taken per segment inside diarize_and_transcribe, so an hour-long
        // job doesn't freeze dictation. Any diarization failure falls back to
        // plain transcription.
        let diarized = if settings.diarize_meetings && crate::diarize::models_downloaded(&app_handle)
        {
            match crate::diarize::diarize_and_transcribe(
                &app_handle,
                &engine_arc,
                &audio,
                &language,
                num_speakers,
            ) {
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
                    // Engine is shared with dictation — room audio is not whispered.
                    Some(engine) => match {
                        engine.set_whisper_mode(false);
                        engine.transcribe(&audio, None, Some(&language))
                    } {
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

        if bail_if_cancelled(&app_handle, meeting_session_id) {
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
                        let _ = app_handle.emit("patter://meeting_progress", format!("Summarizing part {}/{}", current, total - 1));
                    } else {
                        let _ = app_handle.emit("patter://meeting_progress", "Synthesizing final summary".to_string());
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

        if bail_if_cancelled(&app_handle, meeting_session_id) {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// One second of a 200 Hz tone at `amp`, at the meeting sample rate.
    fn tone(amp: f32) -> Vec<f32> {
        (0..WHISPER_SAMPLE_RATE as usize)
            .map(|i| {
                amp * (i as f32 * 2.0 * std::f32::consts::PI * 200.0
                    / WHISPER_SAMPLE_RATE as f32)
                    .sin()
            })
            .collect()
    }

    fn peak_of(a: &[f32]) -> f32 {
        a.iter().map(|s| s.abs()).fold(0.0f32, f32::max)
    }

    #[test]
    fn normalize_scales_down_unnormalized_driver_output() {
        // cpal handing back raw integers as f32.
        let out = normalize_for_asr(tone(8000.0));
        assert!((peak_of(&out) - 1.0).abs() < 1e-3, "peak {}", peak_of(&out));
    }

    #[test]
    fn normalize_lifts_quiet_room_audio() {
        // Far-field speech across a conference table: boost targets RMS 0.1,
        // which for a sine is a 0.141 peak — well clear of clipping.
        let out = normalize_for_asr(tone(0.02));
        let rms = (out.iter().map(|s| s * s).sum::<f32>() / out.len() as f32).sqrt();
        assert!((rms - 0.1).abs() < 0.01, "rms {rms}");
        assert!(peak_of(&out) <= 0.95, "peak {}", peak_of(&out));
    }

    #[test]
    fn normalize_leaves_healthy_audio_and_nans_alone() {
        // Already at a good level — no attenuation.
        let out = normalize_for_asr(tone(0.4));
        assert!((peak_of(&out) - 0.4).abs() < 1e-3, "peak {}", peak_of(&out));

        // A NaN from a flaky driver must not poison the whole buffer.
        let mut audio = tone(0.4);
        audio[100] = f32::NAN;
        assert!(normalize_for_asr(audio).iter().all(|s| s.is_finite()));
    }
}
