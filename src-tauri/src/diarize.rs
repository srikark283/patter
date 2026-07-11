use sherpa_onnx::{
    FastClusteringConfig, OfflineSpeakerDiarization, OfflineSpeakerDiarizationConfig,
    OfflineSpeakerSegmentationModelConfig, OfflineSpeakerSegmentationPyannoteModelConfig,
    SpeakerEmbeddingExtractorConfig,
};
use tauri::Manager;

use crate::asr::ASREngine;
use crate::state::AppState;

pub const SEGMENTATION_ID: &str = "diar-segmentation";
pub const EMBEDDING_ID: &str = "diar-embedding";

pub fn models_downloaded(app: &tauri::AppHandle) -> bool {
    let mm = &app.state::<AppState>().model_manager;
    mm.is_downloaded(SEGMENTATION_ID) && mm.is_downloaded(EMBEDDING_ID)
}

/// Diarize `audio` (16 kHz mono) and transcribe each speaker segment with the
/// active ASR engine, producing a "Speaker N: text" transcript.
pub fn diarize_and_transcribe(
    app: &tauri::AppHandle,
    engine: &mut Box<dyn ASREngine>,
    audio: &[f32],
    language: &str,
) -> Result<String, String> {
    const SAMPLE_RATE: usize = 16_000;

    let mm = &app.state::<AppState>().model_manager;
    let seg_path = mm
        .variant_file_path(SEGMENTATION_ID)
        .ok_or("segmentation model missing")?;
    let emb_path = mm
        .variant_file_path(EMBEDDING_ID)
        .ok_or("embedding model missing")?;

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
        // ponytail: num_clusters=-1 auto-estimates speaker count via threshold
        // 0.5; expose a "number of speakers" setting if auto proves flaky.
        clustering: FastClusteringConfig::default(),
        ..Default::default()
    };

    let diarizer =
        OfflineSpeakerDiarization::create(&config).ok_or("failed to create diarizer")?;
    let result = diarizer.process(audio).ok_or("diarization failed")?;
    let segments = result.sort_by_start_time();
    if segments.is_empty() {
        return Err("no speaker segments found".to_string());
    }

    let mut lines: Vec<String> = Vec::new();
    for seg in &segments {
        let start = ((seg.start * SAMPLE_RATE as f32) as usize).min(audio.len());
        let end = ((seg.end * SAMPLE_RATE as f32).ceil() as usize).min(audio.len());
        if end <= start {
            continue;
        }
        // Whisper needs >= 1s of audio; pad by taking at least a second.
        let end = end.max((start + SAMPLE_RATE).min(audio.len()));
        match engine.transcribe(&audio[start..end], None, Some(language)) {
            Ok(text) if !text.trim().is_empty() => {
                lines.push(format!("Speaker {}: {}", seg.speaker + 1, text.trim()));
            }
            Ok(_) => {}
            Err(e) => eprintln!("[diarize] segment transcription failed: {}", e),
        }
    }

    if lines.is_empty() {
        return Err("no speech in any segment".to_string());
    }
    println!(
        "[diarize] {} speakers, {} segments, {} spoken lines",
        result.num_speakers(),
        segments.len(),
        lines.len()
    );
    Ok(lines.join("\n"))
}
