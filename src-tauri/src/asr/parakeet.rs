use super::ASREngine;
use anyhow::Result;
use sherpa_onnx::{OfflineRecognizer, OfflineRecognizerConfig};

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
}

impl ASREngine for ParakeetEngine {
    fn transcribe(&mut self, audio: &[f32], _prompt: Option<&str>, _language: Option<&str>) -> Result<String> {
        let stream = self.recognizer.create_stream();
        stream.accept_waveform(16000, audio);
        self.recognizer.decode(&stream);
        let result = stream.get_result()
            .ok_or_else(|| anyhow::anyhow!("No result from stream"))?;
        Ok(result.text.clone())
    }
}

// Ensure it implements Send (since sherpa-onnx OfflineRecognizer might not by default depending on the bindings, but usually it does)
unsafe impl Send for ParakeetEngine {}
