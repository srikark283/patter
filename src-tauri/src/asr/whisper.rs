use super::ASREngine;
use anyhow::Result;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub struct WhisperEngine {
    ctx: WhisperContext,
}

impl WhisperEngine {
    pub fn new(model_path: &str) -> Result<Self> {
        let ctx = WhisperContext::new_with_params(model_path, WhisperContextParameters::default())?;
        Ok(Self { ctx })
    }
}

impl ASREngine for WhisperEngine {
    fn transcribe(&mut self, audio: &[f32], prompt: Option<&str>) -> Result<String> {
        let mut state = self.ctx.create_state()?;
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some("en"));
        params.set_print_progress(false);
        params.set_print_special(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        if let Some(p) = prompt {
            if !p.is_empty() {
                params.set_initial_prompt(p);
            }
        }

        state.full(params, audio)?;

        let n = state.full_n_segments()?;
        let mut transcript = String::new();
        for i in 0..n {
            transcript.push_str(state.full_get_segment_text(i)?.trim());
            transcript.push(' ');
        }
        
        Ok(transcript.trim().to_string())
    }
}
