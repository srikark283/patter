use super::ASREngine;
use anyhow::Result;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters, WhisperState};

/// whisper.cpp trims the initial prompt to `n_text_ctx / 2 - 1` tokens. Every
/// Whisper model ships `n_text_ctx = 448`, so the real budget is 223 — and the
/// trim keeps the *tail*, meaning a long dictionary silently loses its earliest
/// entries, potentially mid-term, leaving a fragment that biases decoding
/// instead of helping. Cutting on a term boundary first keeps that honest.
const MAX_PROMPT_TOKENS: usize = 223;

/// Drops leading terms until the prompt fits `max_tokens`, so what survives is
/// whole terms rather than whatever the tokenizer's tail happened to land on.
/// Keeps the tail because that is the half whisper.cpp would have kept anyway —
/// the point here is losing entries cleanly, and knowing that it happened.
///
/// `count` is injected so this stays testable without loading a model.
fn cap_prompt(prompt: &str, max_tokens: usize, count: impl Fn(&str) -> usize) -> String {
    if count(prompt) <= max_tokens {
        return prompt.to_string();
    }
    let terms: Vec<&str> = prompt
        .split(',')
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .collect();

    // Grow from the end while it still fits; the first term that busts the
    // budget ends it, since everything earlier is even further from the audio.
    let mut kept = 0;
    for n in 1..=terms.len() {
        let candidate = terms[terms.len() - n..].join(", ");
        if count(&candidate) > max_tokens {
            break;
        }
        kept = n;
    }
    terms[terms.len() - kept..].join(", ")
}

pub struct WhisperEngine {
    ctx: WhisperContext,
    whisper_mode: bool,
    /// Built once and reused. Allocating a state means allocating the KV cache
    /// and scratch buffers, which is pure overhead on every dictation after the
    /// first. Safe to reuse because `set_no_context(true)` clears the carried
    /// prompt each call, so nothing leaks between transcriptions.
    state: Option<WhisperState>,
    /// `ggml-*.en.bin` weights are trained on English alone. Asking one for
    /// another language doesn't error — it returns confident nonsense — so the
    /// language argument has to be dropped rather than passed through. Derived
    /// from the filename instead of a catalog flag so it can't drift out of
    /// sync with the file actually loaded.
    english_only: bool,
}

/// whisper.cpp names English-only weights `ggml-<size>.en.bin`; every
/// multilingual build drops the `.en`. Reading it off the filename keeps this
/// tied to the file actually loaded rather than to a catalog flag that can
/// drift.
fn is_english_only(model_path: &str) -> bool {
    model_path.ends_with(".en.bin")
}

impl WhisperEngine {
    pub fn new(model_path: &str) -> Result<Self> {
        let ctx = WhisperContext::new_with_params(model_path, WhisperContextParameters::default())?;
        let english_only = is_english_only(model_path);
        Ok(Self { ctx, whisper_mode: false, state: None, english_only })
    }
}

impl ASREngine for WhisperEngine {
    fn set_whisper_mode(&mut self, on: bool) {
        self.whisper_mode = on;
    }

    fn transcribe(&mut self, audio: &[f32], prompt: Option<&str>, language: Option<&str>) -> Result<String> {
        if self.state.is_none() {
            let started = std::time::Instant::now();
            self.state = Some(self.ctx.create_state()?);
            println!("[asr] whisper state allocated in {}ms", started.elapsed().as_millis());
        }
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

        // "auto" leaves whisper to detect from the first 30s. An `.en` model has
        // no other language to detect or be told about, so leave it alone: a
        // stale language setting from a previous multilingual model must not
        // follow the user onto English-only weights.
        if let Some(l) = language {
            if l != "auto" && !self.english_only {
                params.set_language(Some(l));
            }
        }
        // Held until after `state.full`, which borrows the prompt it is given.
        let capped;
        if let Some(p) = prompt {
            if !p.is_empty() {
                capped = cap_prompt(p, MAX_PROMPT_TOKENS, |s| {
                    self.ctx.tokenize(s, MAX_PROMPT_TOKENS * 4).map_or(0, |t| t.len())
                });
                if capped.len() < p.len() {
                    eprintln!(
                        "[asr] dictionary is larger than Whisper's {}-token prompt budget — \
                         kept the last {} of {} chars. Trim the dictionary so the terms you \
                         care about aren't the ones dropped.",
                        MAX_PROMPT_TOKENS,
                        capped.len(),
                        p.len()
                    );
                }
                params.set_initial_prompt(&capped);
            }
        }

        // Taken last: the prompt closure above borrows `self.ctx`, and this is a
        // mutable borrow of a different field.
        let state = self
            .state
            .as_mut()
            .expect("state allocated at the top of transcribe");

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

#[cfg(test)]
mod tests {
    use super::{cap_prompt, is_english_only, MAX_PROMPT_TOKENS};

    /// Every filename in the catalog, both families. Getting this backwards
    /// either silently ignores the user's language on a multilingual model, or
    /// feeds a language to `.en` weights that answer with confident nonsense.
    #[test]
    fn english_only_weights_are_recognised_by_filename() {
        for p in ["ggml-tiny.en.bin", "ggml-base.en.bin", "ggml-small.en.bin"] {
            assert!(is_english_only(p), "{p} should be English-only");
            assert!(is_english_only(&format!("/Users/x/models/whisper/{p}")));
        }
        for p in [
            "ggml-tiny.bin",
            "ggml-base.bin",
            "ggml-small.bin",
            "ggml-medium.bin",
            "ggml-large-v3-turbo.bin",
        ] {
            assert!(!is_english_only(p), "{p} should be multilingual");
            assert!(!is_english_only(&format!("/Users/x/models/whisper/{p}")));
        }
    }

    /// Stands in for Whisper's BPE: close enough to exercise the boundary logic
    /// without loading a model.
    fn words(s: &str) -> usize {
        s.split_whitespace().count()
    }

    #[test]
    fn short_prompts_pass_through_untouched() {
        let p = "Patter, Ollama, Parakeet";
        assert_eq!(cap_prompt(p, 10, words), p);
    }

    #[test]
    fn long_prompts_keep_whole_terms_from_the_tail() {
        let p = "alpha, bravo, charlie, delta, echo";
        let capped = cap_prompt(p, 2, words);
        assert_eq!(capped, "delta, echo");
        // Never a fragment of a term, which is what whisper's own trim risks.
        for term in capped.split(", ") {
            assert!(p.split(", ").any(|t| t == term), "{term} is not a whole term");
        }
    }

    #[test]
    fn a_single_oversized_term_does_not_panic_or_return_garbage() {
        let p = "one two three four five";
        // Budget smaller than the only term: nothing fits, so nothing is sent.
        assert_eq!(cap_prompt(p, 2, words), "");
    }

    #[test]
    fn empty_and_separator_only_prompts_are_safe() {
        assert_eq!(cap_prompt("", 5, |_| 99), "");
        assert_eq!(cap_prompt(" , , ", 0, |_| 99), "");
    }

    #[test]
    fn the_budget_matches_whispers_documented_limit() {
        // n_text_ctx / 2 - 1, with n_text_ctx = 448 on every Whisper model.
        assert_eq!(MAX_PROMPT_TOKENS, 448 / 2 - 1);
    }
}
