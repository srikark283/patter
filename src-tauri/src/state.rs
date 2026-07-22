use crate::asr::ASREngine;
use crate::models;
use std::sync::{atomic::AtomicBool, mpsc::Sender, Arc, Mutex};

pub enum AudioCommand {
    Start(Arc<Mutex<Vec<f32>>>, Option<String>),
    Stop,
    Reconnect(Arc<Mutex<Vec<f32>>>),
}

pub struct AppState {
    pub captured: Arc<Mutex<Vec<f32>>>,
    pub audio_tx: Sender<AudioCommand>,
    pub device_config: Arc<Mutex<cpal::SupportedStreamConfig>>,
    pub is_recording: Arc<AtomicBool>,
    pub is_paused: Arc<AtomicBool>,
    /// App the user was in when recording started — the paste target.
    pub frontmost_app: Arc<Mutex<Option<String>>>,
    pub meeting_captured: Arc<Mutex<Vec<f32>>>,
    /// Open handle to the on-disk meeting buffer (16 kHz mono f32-le), so long
    /// meetings hold at most a couple seconds of raw audio in RAM. The mutex
    /// also orders concurrent drains.
    pub meeting_file: Arc<Mutex<Option<std::fs::File>>>,
    pub is_meeting_recording: Arc<AtomicBool>,
    /// Wall-clock start (ms since epoch) of the current meeting recording, so
    /// any UI that mounts mid-meeting (not just the always-running HUD) can
    /// compute the same elapsed time instead of counting from 0 at mount.
    pub meeting_start_ms: Arc<std::sync::atomic::AtomicU64>,
    /// Set by `cancel_meeting` (increments ID) to tell the post-recording pipeline (transcribe
    /// → diarize → summarize) to bail at its next checkpoint instead of saving.
    pub meeting_session_id: Arc<std::sync::atomic::AtomicU64>,
    /// Set by `cancel` (for dictation) to tell the post-recording pipeline
    /// to bail at its next checkpoint instead of saving.
    pub dictation_session_id: Arc<std::sync::atomic::AtomicU64>,
    pub engine: Arc<Mutex<Option<Box<dyn ASREngine>>>>,
    pub active_engine_id: Arc<Mutex<Option<String>>>,
    pub model_manager: models::registry::ModelManager,
    pub settings: Arc<Mutex<crate::db::Settings>>,
}
