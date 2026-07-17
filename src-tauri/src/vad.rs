use sherpa_onnx::{SileroVadModelConfig, VadModelConfig, VoiceActivityDetector};
use std::path::PathBuf;
use tauri::Manager;

const MODEL_URL: &str =
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx";
const SAMPLE_RATE: i32 = 16_000;
const WINDOW_SIZE: usize = 512;
/// Silence inserted between speech segments so words don't run together.
const GAP_SAMPLES: usize = (16_000.0 * 0.2) as usize;

/// Path to silero_vad.onnx in app data, downloading it (~2.3MB) on first use.
pub fn ensure_model(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("models");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("silero_vad.onnx");
    if path.exists() {
        return Ok(path);
    }
    let bytes = reqwest::blocking::get(MODEL_URL)
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.bytes())
        .map_err(|e| format!("VAD model download failed: {}", e))?;
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Keep only speech from 16kHz mono audio. Empty result = no speech detected.
pub fn trim_silence(model_path: &PathBuf, audio: &[f32]) -> Result<Vec<f32>, String> {
    let config = VadModelConfig {
        silero_vad: SileroVadModelConfig {
            model: Some(model_path.to_string_lossy().into_owned()),
            threshold: 0.2,
            min_silence_duration: 1.0,
            min_speech_duration: 0.1,
            max_speech_duration: 60.0,
            window_size: WINDOW_SIZE as i32,
        },
        sample_rate: SAMPLE_RATE,
        num_threads: 1,
        ..Default::default()
    };
    let vad = VoiceActivityDetector::create(&config, 60.0)
        .ok_or("failed to create VAD (bad model file?)")?;

    let mut out: Vec<f32> = Vec::new();
    let push_segments = |vad: &VoiceActivityDetector, out: &mut Vec<f32>| {
        while !vad.is_empty() {
            if let Some(seg) = vad.front() {
                if !out.is_empty() {
                    out.extend(std::iter::repeat(0.0).take(GAP_SAMPLES));
                }
                out.extend_from_slice(seg.samples());
            }
            vad.pop();
        }
    };

    for chunk in audio.chunks(WINDOW_SIZE) {
        vad.accept_waveform(chunk);
        push_segments(&vad, &mut out);
    }
    vad.flush();
    push_segments(&vad, &mut out);

    Ok(out)
}
