use std::sync::{Arc, Mutex};

use sherpa_onnx::{
    FastClusteringConfig, OfflineSpeakerDiarization, OfflineSpeakerDiarizationConfig,
    OfflineSpeakerSegmentationModelConfig, OfflineSpeakerSegmentationPyannoteModelConfig,
    SpeakerEmbeddingExtractorConfig,
};
use tauri::{Emitter, Manager};

use crate::asr::ASREngine;
use crate::state::AppState;

pub const SEGMENTATION_ID: &str = "diar-segmentation";
pub const EMBEDDING_ID: &str = "diar-embedding";

/// Merge adjacent segments of the same speaker when the gap between them is
/// shorter than this — fewer, longer transcription calls and cleaner output.
const MERGE_GAP_SECONDS: f32 = 1.0;

pub fn models_downloaded(app: &tauri::AppHandle) -> bool {
    let mm = &app.state::<AppState>().model_manager;
    mm.is_downloaded(SEGMENTATION_ID) && mm.is_downloaded(EMBEDDING_ID)
}

fn fmt_ts(secs: f32) -> String {
    let s = secs.max(0.0) as u64;
    let (h, m, sec) = (s / 3600, (s % 3600) / 60, s % 60);
    if h > 0 {
        format!("{}:{:02}:{:02}", h, m, sec)
    } else {
        format!("{:02}:{:02}", m, sec)
    }
}

/// Diarize `audio` (16 kHz mono) and transcribe each speaker turn with the
/// active ASR engine, producing "[mm:ss] Speaker N: text" lines. The engine
/// lock is taken per turn so long meetings don't block dictation.
pub fn diarize_and_transcribe(
    app: &tauri::AppHandle,
    engine: &Arc<Mutex<Option<Box<dyn ASREngine>>>>,
    audio: &[f32],
    language: &str,
    num_speakers: Option<i32>,
) -> Result<String, String> {
    const SAMPLE_RATE: usize = 16_000;

    let (seg_path, emb_path) = {
        let mm = &app.state::<AppState>().model_manager;
        (
            mm.variant_file_path(SEGMENTATION_ID)
                .ok_or("segmentation model missing")?,
            mm.variant_file_path(EMBEDDING_ID)
                .ok_or("embedding model missing")?,
        )
    };

    let config = OfflineSpeakerDiarizationConfig {
        segmentation: OfflineSpeakerSegmentationModelConfig {
            pyannote: OfflineSpeakerSegmentationPyannoteModelConfig {
                model: Some(seg_path.to_string_lossy().into_owned()),
            },
            ..Default::default()
        },
        embedding: SpeakerEmbeddingExtractorConfig {
            model: Some(emb_path.to_string_lossy().into_owned()),
            ..Default::default()
        },
        // Auto (-1) estimates speaker count via a distance threshold, which can
        // badly over-segment on some recordings; an explicit count from the
        // user forces exact clustering instead.
        clustering: FastClusteringConfig {
            num_clusters: num_speakers.unwrap_or(-1),
            ..Default::default()
        },
        ..Default::default()
    };

    let _ = app.emit("patter://meeting_progress", "Detecting speakers…");
    let diarizer =
        OfflineSpeakerDiarization::create(&config).ok_or("failed to create diarizer")?;
    let result = diarizer.process(audio).ok_or("diarization failed")?;
    let segments = result.sort_by_start_time();
    if segments.is_empty() {
        return Err("no speaker segments found".to_string());
    }

    // Collapse consecutive same-speaker segments into turns.
    let mut turns: Vec<(i32, f32, f32)> = Vec::new();
    for seg in &segments {
        if let Some(last) = turns.last_mut() {
            if last.0 == seg.speaker && seg.start - last.2 < MERGE_GAP_SECONDS {
                last.2 = seg.end;
                continue;
            }
        }
        turns.push((seg.speaker, seg.start, seg.end));
    }

    // Number speakers by order of first appearance, not pyannote's indices.
    let mut speaker_order: Vec<i32> = Vec::new();
    for (spk, _, _) in &turns {
        if !speaker_order.contains(spk) {
            speaker_order.push(*spk);
        }
    }

    let total = turns.len();
    let mut lines: Vec<String> = Vec::new();
    for (i, (spk, start, end)) in turns.iter().enumerate() {
        let _ = app.emit(
            "patter://meeting_progress",
            format!("Transcribing turn {} of {}", i + 1, total),
        );
        let s = ((*start * SAMPLE_RATE as f32) as usize).min(audio.len());
        let e = ((*end * SAMPLE_RATE as f32).ceil() as usize).min(audio.len());
        if e <= s {
            continue;
        }
        // Whisper needs >= 1s of audio; pad by taking at least a second.
        let e = e.max((s + SAMPLE_RATE).min(audio.len()));

        // Lock per turn: dictation stays usable while a meeting processes.
        let text = {
            let mut lock = engine.lock().unwrap();
            let eng = lock.as_mut().ok_or("no model loaded")?;
            eng.transcribe(&audio[s..e], None, Some(language))
        };
        match text {
            Ok(t) if !t.trim().is_empty() => {
                let n = speaker_order.iter().position(|x| x == spk).unwrap() + 1;
                lines.push(format!("[{}] Speaker {}: {}", fmt_ts(*start), n, t.trim()));
            }
            Ok(_) => {}
            Err(e) => eprintln!("[diarize] turn transcription failed: {}", e),
        }
    }

    if lines.is_empty() {
        return Err("no speech in any segment".to_string());
    }
    println!(
        "[diarize] {} speakers, {} segments -> {} turns, {} spoken lines",
        result.num_speakers(),
        segments.len(),
        total,
        lines.len()
    );
    Ok(lines.join("\n"))
}
