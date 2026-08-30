use sherpa_onnx::{SileroVadModelConfig, VadModelConfig, VoiceActivityDetector};
use std::collections::hash_map::Entry;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
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

/// Default speech probability above which Silero calls a frame speech.
pub const DEFAULT_THRESHOLD: f32 = 0.2;
/// Whispered speech has no vocal-fold vibration, so Silero — trained on
/// phonated speech — scores it far lower and would drop it entirely.
pub const WHISPER_THRESHOLD: f32 = 0.08;

/// Detectors, kept for the life of the process and reused.
///
/// `VoiceActivityDetector::create` builds an onnxruntime session and loads the
/// model, and that was happening on every dictation — after the hotkey release,
/// inside the pipeline, with the user watching an empty cursor. The detector is
/// `Send + Sync` and `reset()` drops every bit of state carried from the last
/// clip, so a fresh one buys nothing.
///
/// Keyed by threshold because it is baked into the config at create time and
/// whisper mode uses a lower one; the map holds one entry, or two for a user
/// who switches modes.
///
/// Worth about 15ms a dictation, measured — less than it looked like from the
/// outside, because Silero is small and its session builds fast.
///
/// ponytail: the inference is still on the hot path, and it is the same 15ms
/// again for a 7.8s clip. Feeding Silero from the capture callback would take
/// that off too, but the gain and tilt stages ahead of it need whole-clip
/// stats, so the audio it would see live is not the audio it sees today —
/// not worth the rework for 15ms.
fn with_detector<T>(
    model_path: &PathBuf,
    threshold: f32,
    f: impl FnOnce(&VoiceActivityDetector) -> T,
) -> Result<T, String> {
    static DETECTORS: OnceLock<Mutex<HashMap<u32, VoiceActivityDetector>>> = OnceLock::new();
    let mut cache = DETECTORS.get_or_init(Default::default).lock().unwrap();

    let vad = match cache.entry(threshold.to_bits()) {
        Entry::Occupied(e) => e.into_mut(),
        Entry::Vacant(e) => {
            let config = VadModelConfig {
                silero_vad: SileroVadModelConfig {
                    model: Some(model_path.to_string_lossy().into_owned()),
                    threshold,
                    min_silence_duration: 1.0,
                    min_speech_duration: 0.1,
                    max_speech_duration: 60.0,
                    window_size: WINDOW_SIZE as i32,
                },
                sample_rate: SAMPLE_RATE,
                num_threads: 1,
                ..Default::default()
            };
            let started = std::time::Instant::now();
            let vad = VoiceActivityDetector::create(&config, 60.0)
                .ok_or("failed to create VAD (bad model file?)")?;
            println!("[vad] detector built in {}ms", started.elapsed().as_millis());
            e.insert(vad)
        }
    };

    // The previous clip's trailing state must not colour this one: `reset`
    // clears the model's internal state, `clear` drops any segment left queued
    // by a caller that bailed out mid-drain.
    vad.reset();
    vad.clear();
    Ok(f(vad))
}

/// Build the detector ahead of time so the first dictation doesn't pay for it.
/// The empty result is the point being thrown away.
pub fn warm(model_path: &PathBuf, threshold: f32) -> Result<(), String> {
    with_detector(model_path, threshold, |_| ())
}

/// Keep only speech from 16kHz mono audio. Empty result = no speech detected.
pub fn trim_silence(model_path: &PathBuf, audio: &[f32], threshold: f32) -> Result<Vec<f32>, String> {
    with_detector(model_path, threshold, |vad| {
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
            push_segments(vad, &mut out);
        }
        vad.flush();
        push_segments(vad, &mut out);

        out
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The reused detector has to behave like a fresh one. Silero carries state
    /// across `accept_waveform` calls, so audio left in it would shift where the
    /// next clip's segments start — silently, and only for dictations after the
    /// first. Ignored by default: it needs the downloaded model and macOS's own
    /// `say`, because Silero scores synthetic tones as noise and a test that
    /// finds no speech proves nothing.
    #[test]
    #[ignore]
    fn a_reused_detector_returns_what_a_fresh_one_would() {
        let clip = spoken_clip();
        let path = model_path();

        let first = trim_silence(&path, &clip, DEFAULT_THRESHOLD).unwrap();
        // A different clip in between, to leave state behind if any is kept.
        let _ = trim_silence(&path, &vec![0.0f32; 16_000], DEFAULT_THRESHOLD).unwrap();
        let third = trim_silence(&path, &clip, DEFAULT_THRESHOLD).unwrap();

        assert!(!first.is_empty(), "VAD found no speech — the test proves nothing");
        assert!(first.len() < clip.len(), "VAD trimmed nothing");
        assert_eq!(first, third, "detector state leaked between clips");
    }

    fn model_path() -> PathBuf {
        PathBuf::from(std::env::var("HOME").unwrap())
            .join("Library/Application Support/com.srikar.patter/models/silero_vad.onnx")
    }

    /// Real speech at 16kHz mono, padded with the silence the VAD is meant to
    /// cut, via the two command-line tools macOS ships.
    fn spoken_clip() -> Vec<f32> {
        let dir = std::env::temp_dir();
        let aiff = dir.join("patter_vad_test.aiff");
        let wav = dir.join("patter_vad_test.wav");
        let run = |cmd: &str, args: &[&str]| {
            assert!(
                std::process::Command::new(cmd).args(args).status().unwrap().success(),
                "{} failed",
                cmd
            );
        };
        run("say", &["-o", aiff.to_str().unwrap(), "testing one two three"]);
        run(
            "afconvert",
            &["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff.to_str().unwrap(), wav.to_str().unwrap()],
        );

        let wave = sherpa_onnx::Wave::read(wav.to_str().unwrap()).expect("read wav");
        assert_eq!(wave.sample_rate(), SAMPLE_RATE);

        let mut clip = vec![0.0f32; 32_000];
        clip.extend_from_slice(wave.samples());
        clip.extend(std::iter::repeat(0.0).take(32_000));
        clip
    }
}
