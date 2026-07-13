pub mod parakeet;
pub mod whisper;


pub trait ASREngine: Send + Sync {
    fn transcribe(&mut self, audio: &[f32], prompt: Option<&str>, language: Option<&str>) -> anyhow::Result<String>;
}
