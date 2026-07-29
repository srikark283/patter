pub mod parakeet;
pub mod whisper;


pub trait ASREngine: Send + Sync {
    fn transcribe(&mut self, audio: &[f32], prompt: Option<&str>, language: Option<&str>) -> anyhow::Result<String>;

    /// Tells the engine the next audio is whispered, so it can decode with
    /// settings suited to low-confidence, unvoiced speech. Engines with no
    /// such knobs ignore it.
    fn set_whisper_mode(&mut self, _on: bool) {}
}
