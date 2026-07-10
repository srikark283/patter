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
    pub meeting_captured: Arc<Mutex<Vec<f32>>>,
    pub is_meeting_recording: Arc<AtomicBool>,
    pub engine: Arc<Mutex<Option<Box<dyn ASREngine>>>>,
    pub active_engine_id: Arc<Mutex<Option<String>>>,
    pub model_manager: models::registry::ModelManager,
    pub settings: Arc<Mutex<crate::db::Settings>>,
}
