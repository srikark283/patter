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

static DRAINS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static DRAINED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Every ~30s of meeting, report what the drain loop is actually doing.
///
/// "RAM grew during a meeting" has two candidate causes that look identical
/// from outside the process: the capture buffer not draining (raw interleaved
/// f32 at the device rate — 1.4 GB/hr at 48kHz stereo), or something else
/// entirely. `left` distinguishes them: it is the capture backlog *after* the
/// drain, so it should sit near zero for the whole meeting. If it climbs, the
/// loop is behind or dead; if it stays flat while Activity Monitor climbs, the
/// growth is not buffered audio and the drain loop is exonerated.
fn log_drain(took: usize, left: usize, cap: usize, channels: usize, src_rate: u32) {
    use std::sync::atomic::Ordering::Relaxed;
    let total = DRAINED.fetch_add(took as u64, Relaxed) + took as u64;
    let n = DRAINS.fetch_add(1, Relaxed) + 1;
    if n % 15 != 0 {
        return;
    }
    let held = |samples: usize| samples as f64 * 4.0 / 1_048_576.0;
    eprintln!(
        "[meeting] drain #{n} ({}ch @ {}Hz): took {:.1} MB, backlog {:.1} MB (cap {:.1} MB), {:.1} MB captured total",
        channels,
        src_rate,
        held(took),
        held(left),
        held(cap),
        held(total as usize),
    );
}

/// Move whatever raw audio has accumulated to the on-disk 16 kHz mono buffer
/// (f32-le, ~220 MB/hr on disk, flat RAM — see the `drain_rss` test). The whole move happens under the
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
    let (chunk, left, cap): (Vec<f32>, usize, usize) = {
        let mut raw = state.meeting_captured.lock().unwrap();
        let take = raw.len() - raw.len() % channels;
        if take == 0 {
            return;
        }
        let chunk = raw.drain(..take).collect();
        (chunk, raw.len(), raw.capacity())
    };
    log_drain(chunk.len(), left, cap, channels, src_rate);
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

/// Read the on-disk buffer back as f32 samples, one block at a time.
///
/// `fs::read` + `chunks_exact(4).collect()` keeps the whole `Vec<u8>` borrowed
/// for the duration of the collect, so both it and the `Vec<f32>` are live at
/// once — 2x the file, ~440 MB for an hour-long meeting, before diarization or
/// ASR allocates anything. This holds the output plus one 64 KB block.
fn read_buffer_f32(path: &std::path::Path) -> std::io::Result<Vec<f32>> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    // Trailing bytes of a torn final write can't form a sample; drop them.
    let mut left = file.metadata()?.len() as usize / 4 * 4;
    let mut out: Vec<f32> = Vec::with_capacity(left / 4);
    // A multiple of 4, so a sample never straddles two blocks.
    let mut block = [0u8; 65536];
    while left > 0 {
        let n = left.min(block.len());
        file.read_exact(&mut block[..n])?;
        out.extend(
            block[..n]
                .chunks_exact(4)
                .map(|b| f32::from_le_bytes(b.try_into().unwrap())),
        );
        left -= n;
    }
    Ok(out)
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

    DRAINS.store(0, Ordering::SeqCst);
    DRAINED.store(0, Ordering::SeqCst);

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
        // Only reachable once recording stops. A panic inside `drain_captured`
        // unwinds past this instead, killing the loop silently and letting the
        // capture buffer grow for the rest of the meeting — so the absence of
        // this line in the log is itself the diagnosis.
        eprintln!(
            "[meeting] drain loop exited cleanly after {} drains",
            DRAINS.load(Ordering::SeqCst)
        );
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
    let audio = read_buffer_f32(&path).unwrap_or_default();
    let _ = std::fs::remove_file(&path);
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
    fn read_buffer_f32_round_trips_across_block_boundaries() {
        // Spans several 64KB blocks and ends mid-block, so the loop's last
        // partial read is exercised.
        let samples: Vec<f32> = (0..40_000).map(|i| (i as f32 * 0.01).sin()).collect();
        let path = std::env::temp_dir().join("patter_read_roundtrip.f32");
        let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        std::fs::write(&path, &bytes).unwrap();
        assert_eq!(read_buffer_f32(&path).unwrap(), samples);

        // A torn final write leaves bytes that can't form a sample: drop them
        // rather than failing the whole read and losing the meeting.
        std::fs::write(&path, &bytes[..bytes.len() - 3]).unwrap();
        let torn = read_buffer_f32(&path).unwrap();
        assert_eq!(torn.len(), samples.len() - 1);
        assert_eq!(torn[..], samples[..samples.len() - 1]);

        std::fs::write(&path, [0u8; 2]).unwrap();
        assert!(read_buffer_f32(&path).unwrap().is_empty());
        let _ = std::fs::remove_file(&path);
    }

    /// Measurement: peak RSS reading an hour-long buffer back, block-wise
    /// versus the `fs::read` + `chunks_exact` it replaced.
    /// `cargo test read_rss -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn read_rss() {
        let rss = || -> i64 {
            let out = std::process::Command::new("ps")
                .args(["-o", "rss=", "-p", &std::process::id().to_string()])
                .output()
                .unwrap();
            String::from_utf8_lossy(&out.stdout).trim().parse().unwrap_or(0)
        };
        // One hour at 16kHz mono f32.
        let path = std::env::temp_dir().join("patter_read_rss.f32");
        {
            let mut f = std::fs::File::create(&path).unwrap();
            let block: Vec<u8> = (0..16_384u32).flat_map(|i| (i as f32).to_le_bytes()).collect();
            for _ in 0..(WHISPER_SAMPLE_RATE as usize * 3600 / 16_384) {
                f.write_all(&block).unwrap();
            }
        }
        let mb = std::fs::metadata(&path).unwrap().len() as f64 / 1_048_576.0;
        let base = rss();
        println!("file {:.0} MB | baseline rss {} KB", mb, base);

        let a = read_buffer_f32(&path).unwrap();
        println!("block-wise: rss +{} KB ({} samples)", rss() - base, a.len());
        drop(a);

        let bytes = std::fs::read(&path).unwrap();
        let b: Vec<f32> = bytes
            .chunks_exact(4)
            .map(|x| f32::from_le_bytes(x.try_into().unwrap()))
            .collect();
        println!("fs::read:   rss +{} KB ({} samples)", rss() - base, b.len());
        drop((bytes, b));
        let _ = std::fs::remove_file(&path);
    }

    /// Measurement, not an assertion: replays the drain loop's exact allocation
    /// pattern for a simulated meeting and reports RSS, to settle whether
    /// in-flight meeting audio accumulates in memory.
    /// `cargo test drain_rss -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn drain_rss() {
        const SRC_RATE: u32 = 48_000;
        const CHANNELS: usize = 2;
        let rss = || -> i64 {
            let out = std::process::Command::new("ps")
                .args(["-o", "rss=", "-p", &std::process::id().to_string()])
                .output()
                .unwrap();
            String::from_utf8_lossy(&out.stdout).trim().parse().unwrap_or(0)
        };

        let path = std::env::temp_dir().join("patter_drain_rss.f32");
        let mut file = std::fs::File::create(&path).unwrap();
        let mut raw: Vec<f32> = Vec::new();
        let base = rss();
        println!("baseline rss {} KB", base);

        // 30 minutes of meeting, one drain every 2s.
        for i in 0..900 {
            // 2s of interleaved stereo, as the cpal callback appends it.
            raw.extend((0..SRC_RATE as usize * 2 * CHANNELS).map(|n| (n as f32 * 0.001).sin()));
            let take = raw.len() - raw.len() % CHANNELS;
            let chunk: Vec<f32> = raw.drain(..take).collect();
            let mono: Vec<f32> = chunk
                .chunks(CHANNELS)
                .map(|f| f.iter().sum::<f32>() / CHANNELS as f32)
                .collect();
            let bytes: Vec<u8> = resample_linear(&mono, SRC_RATE, WHISPER_SAMPLE_RATE)
                .iter()
                .flat_map(|s| s.to_le_bytes())
                .collect();
            file.write_all(&bytes).unwrap();
            if i % 300 == 299 {
                println!(
                    "{:>2} min: rss {} KB (+{} KB) | raw buffer len {} cap {}",
                    (i + 1) * 2 / 60,
                    rss(),
                    rss() - base,
                    raw.len(),
                    raw.capacity()
                );
            }
        }
        drop(file);
        let mb = std::fs::metadata(&path).unwrap().len() as f64 / 1_048_576.0;
        println!("buffer file {:.0} MB for 30 min => {:.0} MB/hr", mb, mb * 2.0);
        let _ = std::fs::remove_file(&path);
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
