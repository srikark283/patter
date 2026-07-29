use super::ASREngine;
use anyhow::Result;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub struct WhisperEngine {
    ctx: WhisperContext,
    whisper_mode: bool,
}

impl WhisperEngine {
    pub fn new(model_path: &str) -> Result<Self> {
        let ctx = WhisperContext::new_with_params(model_path, WhisperContextParameters::default())?;
        Ok(Self { ctx, whisper_mode: false })
    }
}

impl ASREngine for WhisperEngine {
    fn set_whisper_mode(&mut self, on: bool) {
        self.whisper_mode = on;
    }

    fn transcribe(&mut self, audio: &[f32], prompt: Option<&str>, language: Option<&str>) -> Result<String> {
        let mut state = self.ctx.create_state()?;
        // Every token in whispered audio is a close call, which is exactly where
        // greedy decoding commits to the wrong word and beam search doesn't.
        // Costs ~2-3x decode time — fine for dictation-length clips.
        let mut params = if self.whisper_mode {
            FullParams::new(SamplingStrategy::BeamSearch { beam_size: 5, patience: -1.0 })
        } else {
            FullParams::new(SamplingStrategy::Greedy { best_of: 1 })
        };
        params.set_print_progress(false);
        params.set_print_special(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);

        // Prevent hallucination loops from cascading across 30s chunks
        params.set_no_context(true);
        // Fallback triggers if the model gets stuck in a hallucination.
        // Whispered speech is genuinely higher-entropy, so the normal threshold
        // fires constantly and the temperature fallback makes output *worse*.
        params.set_entropy_thold(if self.whisper_mode { 3.0 } else { 2.4 });
        // Whisper's no-speech head keys on voicing, which whispering has none of:
        // at 0.6 it discards whole segments of real speech as silence.
        params.set_no_speech_thold(if self.whisper_mode { 0.9 } else { 0.6 });
        params.set_single_segment(false);

        if let Some(l) = language {
            if l != "auto" {
                params.set_language(Some(l));
            }
        }
        if let Some(p) = prompt {
            if !p.is_empty() {
                params.set_initial_prompt(p);
            }
        }

        state.full(params, audio)?;

        let n = state.full_n_segments()?;
        let mut transcript = String::new();
        
        for i in 0..n {
            let seg = state.full_get_segment_text(i)?.trim().to_string();
            let lower = seg.to_lowercase();
            println!("Raw seg: {:?}", seg);
            
            // Mitigate common Whisper hallucinations on silence or background noise
            let is_hallucination = 
                lower == "and others." || 
                lower == "thank you." || 
                lower == "thank you for watching." || 
                lower == "thanks for watching." || 
                lower == "subscribe." || 
                lower == "subscribe to my channel." || 
                lower == "please subscribe." ||
                lower == "much of these are the same." ||
                lower == "amem." ||
                lower == "amen." ||
                lower == "." ||
                lower.is_empty();
                
            if !is_hallucination {
                transcript.push_str(&seg);
                transcript.push(' ');
            }
        }
        
        Ok(transcript.trim().to_string())
    }
}
