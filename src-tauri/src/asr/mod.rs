pub mod parakeet;
pub mod whisper;

use anyhow::Result;

pub trait ASREngine: Send + Sync {
    fn transcribe(&mut self, audio: &[f32], prompt: Option<&str>, language: Option<&str>) -> anyhow::Result<String>;
}
