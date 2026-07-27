use super::ASREngine;
use anyhow::Result;
use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig};

const SAMPLE_RATE: usize = 16_000;
/// Parakeet's FastConformer encoder uses full self-attention, so peak memory
/// grows ~O(T^2): a 40-minute meeting in one pass needs tens of GB. Decode in
/// bounded chunks instead. 60s matches the VAD's max_speech_duration.
const MAX_CHUNK: usize = 60 * SAMPLE_RATE;
/// Window scanned at the end of a chunk for a quiet spot to cut on.
const SEARCH: usize = 2 * SAMPLE_RATE;
/// Granularity of the quiet-spot search (100ms).
const WIN: usize = SAMPLE_RATE / 10;

/// End index for the chunk starting at `start`: the hard cap, pulled back to
/// the quietest 100ms in the preceding 2s so the cut lands between words.
/// ponytail: energy-minimum split, no overlap/dedup. Swap for VAD-driven
/// segment boundaries if seams show up mid-word.
fn split_point(audio: &[f32], start: usize) -> usize {
    let hard = start + MAX_CHUNK;
    if hard >= audio.len() {
        return audio.len();
    }
    let energy = |at: usize| audio[at..at + WIN].iter().map(|s| s * s).sum::<f32>();
    (hard - SEARCH..hard - WIN)
        .step_by(WIN / 2)
        .min_by(|&a, &b| energy(a).total_cmp(&energy(b)))
        .map(|quiet| quiet + WIN / 2)
        .unwrap_or(hard)
}

pub struct ParakeetEngine {
    recognizer: OfflineRecognizer,
}

impl ParakeetEngine {
    pub fn new(model_dir: &str) -> Result<Self> {
        let mut config = OfflineRecognizerConfig::default();
        config.model_config.transducer.encoder = Some(format!("{}/encoder.int8.onnx", model_dir));
        config.model_config.transducer.decoder = Some(format!("{}/decoder.int8.onnx", model_dir));
        config.model_config.transducer.joiner = Some(format!("{}/joiner.int8.onnx", model_dir));
        config.model_config.tokens = Some(format!("{}/tokens.txt", model_dir));
        config.model_config.num_threads = 4;

        let recognizer = OfflineRecognizer::create(&config)
            .ok_or_else(|| anyhow::anyhow!("Failed to create OfflineRecognizer"))?;
        Ok(Self { recognizer })
    }

    fn decode_chunk(&self, audio: &[f32]) -> Result<String> {
        let stream = self.recognizer.create_stream();
        stream.accept_waveform(SAMPLE_RATE as i32, audio);
        self.recognizer.decode(&stream);
        let result = stream.get_result()
            .ok_or_else(|| anyhow::anyhow!("No result from stream"))?;
        Ok(result.text.clone())
    }
}

impl ASREngine for ParakeetEngine {
    fn transcribe(&mut self, audio: &[f32], _prompt: Option<&str>, _language: Option<&str>) -> Result<String> {
        let mut parts: Vec<String> = Vec::new();
        let mut pos = 0;
        while pos < audio.len() {
            let end = split_point(audio, pos);
            let text = self.decode_chunk(&audio[pos..end])?;
            if !text.trim().is_empty() {
                parts.push(text.trim().to_string());
            }
            pos = end;
        }
        Ok(parts.join(" "))
    }
}

// Ensure it implements Send (since sherpa-onnx OfflineRecognizer might not by default depending on the bindings, but usually it does)
unsafe impl Send for ParakeetEngine {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunking_covers_audio_and_cuts_on_silence() {
        // Short audio stays a single chunk.
        let short = vec![0.5f32; SAMPLE_RATE];
        assert_eq!(split_point(&short, 0), short.len());

        // 100 minutes of tone with a silent gap 1s before the hard cap.
        let mut audio = vec![0.5f32; 100 * 60 * SAMPLE_RATE];
        let gap = MAX_CHUNK - SAMPLE_RATE;
        audio[gap..gap + WIN].fill(0.0);
        let end = split_point(&audio, 0);
        assert!(end > gap && end <= gap + WIN, "cut {} not in gap", end);

        // Walking the whole buffer terminates and covers every sample.
        let mut pos = 0;
        let mut chunks = 0;
        while pos < audio.len() {
            let next = split_point(&audio, pos);
            assert!(next > pos && next - pos <= MAX_CHUNK);
            pos = next;
            chunks += 1;
        }
        assert_eq!(pos, audio.len());
        assert!(chunks >= 100);
    }
}
