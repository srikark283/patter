pub mod parakeet;
pub mod whisper;

use anyhow::Result;

pub trait ASREngine: Send {
    fn transcribe(&mut self, audio: &[f32], prompt: Option<&str>) -> Result<String>;
}
