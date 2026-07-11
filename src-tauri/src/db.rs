use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::fs;
use tauri::Manager;
use std::time::{SystemTime, UNIX_EPOCH};

fn default_hud_position() -> String {
    "bottom".to_string()
}

fn default_play_sounds() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Settings {
    pub hotkey: String,
    pub microphone: Option<String>,
    pub output_mode: String,
    pub custom_prompt: String,
    pub autostart: bool,
    pub language: String,
    pub silence_timeout_ms: u32,
    pub active_engine_id: Option<String>,
    #[serde(default)]
    pub llm_cleanup_enabled: bool,
    #[serde(default)]
    pub ollama_model: Option<String>,
    #[serde(default)]
    pub meeting_ollama_model: Option<String>,
    #[serde(default = "default_hud_position")]
    pub hud_position: String,
    #[serde(default = "default_play_sounds")]
    pub play_sounds: bool,
    #[serde(default = "default_trim_silence")]
    pub trim_silence: bool,
    /// False for fresh installs and installs predating onboarding.
    #[serde(default)]
    pub onboarding_done: bool,
    /// Hold hotkey to record, release to transcribe (vs press-to-toggle).
    #[serde(default)]
    pub push_to_talk: bool,
    /// Label speakers in meeting transcripts (needs diarization models).
    #[serde(default)]
    pub diarize_meetings: bool,
    /// Per-app cleanup instructions, matched against the frontmost app name.
    #[serde(default)]
    pub app_profiles: Vec<AppProfile>,
    /// Check GitHub releases for updates on launch.
    #[serde(default = "default_auto_update")]
    pub auto_update: bool,
}

fn default_auto_update() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppProfile {
    /// Case-insensitive substring of the app name ("slack", "mail").
    pub app: String,
    /// Extra instruction for the Ollama cleanup pass in that app.
    pub prompt: String,
}

fn default_trim_silence() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            hotkey: "Alt+Space".to_string(),
            microphone: None,
            output_mode: "type".to_string(),
            custom_prompt: "".to_string(),
            autostart: true, // Default to true for system tray utilities
            language: "auto".to_string(),
            silence_timeout_ms: 1000,
            active_engine_id: None,
            llm_cleanup_enabled: false,
            ollama_model: None,
            meeting_ollama_model: None,
            hud_position: "bottom".to_string(),
            play_sounds: true,
            trim_silence: true,
            onboarding_done: false,
            push_to_talk: false,
            diarize_meetings: false,
            app_profiles: Vec::new(),
            auto_update: true,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct AppStats {
    pub total_words: u32,
    pub time_saved_seconds: u32,
    pub transcriptions_count: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MeetingRecord {
    pub id: String,
    pub timestamp_ms: u64,
    pub title: String,
    pub duration_seconds: f32,
    pub transcript: String,
    pub summary: String,
    #[serde(default)]
    pub minutes: Vec<String>,
    #[serde(default)]
    pub decisions: Vec<String>,
    #[serde(default)]
    pub action_items: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TranscriptionRecord {
    pub id: String,
    pub timestamp_ms: u64,
    pub text: String,
    pub duration_seconds: f32,
    pub words: u32,
    /// Engine inference time; 0 for records predating this field.
    #[serde(default)]
    pub transcribe_ms: u32,
}

pub struct Db {
    data_dir: PathBuf,
}

impl Db {
    pub fn new(app_handle: &tauri::AppHandle) -> Self {
        let data_dir = app_handle.path().app_data_dir().expect("failed to get app data dir");
        if !data_dir.exists() {
            let _ = fs::create_dir_all(&data_dir);
        }
        Self { data_dir }
    }

    pub fn get_settings(&self) -> Settings {
        let path = self.data_dir.join("settings.json");
        if let Ok(content) = fs::read_to_string(path) {
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Settings::default()
        }
    }

    pub fn save_settings(&self, settings: &Settings) {
        let path = self.data_dir.join("settings.json");
        if let Ok(content) = serde_json::to_string_pretty(settings) {
            let _ = fs::write(path, content);
        }
    }

    pub fn get_stats(&self) -> AppStats {
        let path = self.data_dir.join("stats.json");
        if let Ok(content) = fs::read_to_string(path) {
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            AppStats::default()
        }
    }

    pub fn save_stats(&self, stats: &AppStats) {
        let path = self.data_dir.join("stats.json");
        if let Ok(content) = serde_json::to_string_pretty(stats) {
            let _ = fs::write(path, content);
        }
    }

    pub fn get_history(&self) -> Vec<TranscriptionRecord> {
        let path = self.data_dir.join("history.json");
        if let Ok(content) = fs::read_to_string(path) {
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Vec::new()
        }
    }

    pub fn save_history(&self, history: &[TranscriptionRecord]) {
        let path = self.data_dir.join("history.json");
        if let Ok(content) = serde_json::to_string_pretty(history) {
            let _ = fs::write(path, content);
        }
    }

    pub fn add_record(&self, mut record: TranscriptionRecord) {
        // ID if none
        if record.id.is_empty() {
            record.id = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis()
                .to_string();
        }
        
        let mut history = self.get_history();
        history.insert(0, record.clone()); // prepend
        if history.len() > 1000 {
            history.truncate(1000);
        }
        self.save_history(&history);
        
        let mut stats = self.get_stats();
        stats.total_words += record.words;
        stats.transcriptions_count += 1;
        
        // Baseline: 40 WPM = 0.66 words per second.
        // Expected time = words * 1.5 seconds.
        let expected_typing_time = record.words as f32 * (60.0 / 40.0);
        let saved = expected_typing_time - record.duration_seconds;
        if saved > 0.0 {
            stats.time_saved_seconds += saved as u32;
        }
        self.save_stats(&stats);
    }
    
    pub fn clear_history(&self) {
        self.save_history(&[]);
        // Keep stats untouched, just clear history log
    }

    pub fn delete_record(&self, id: &str) -> bool {
        let mut history = self.get_history();
        let initial_len = history.len();
        history.retain(|r| r.id != id);
        if history.len() != initial_len {
            self.save_history(&history);
            true
        } else {
            false
        }
    }

    pub fn get_meetings(&self) -> Vec<MeetingRecord> {
        let path = self.data_dir.join("meetings.json");
        if let Ok(content) = fs::read_to_string(path) {
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Vec::new()
        }
    }

    pub fn save_meetings(&self, meetings: &[MeetingRecord]) {
        let path = self.data_dir.join("meetings.json");
        if let Ok(content) = serde_json::to_string_pretty(meetings) {
            let _ = fs::write(path, content);
        }
    }

    pub fn add_meeting(&self, mut record: MeetingRecord) {
        if record.id.is_empty() {
            record.id = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis()
                .to_string();
        }
        let mut meetings = self.get_meetings();
        meetings.insert(0, record);
        self.save_meetings(&meetings);
    }

    pub fn delete_meeting(&self, id: &str) -> bool {
        let mut meetings = self.get_meetings();
        let initial_len = meetings.len();
        meetings.retain(|m| m.id != id);
        if meetings.len() != initial_len {
            self.save_meetings(&meetings);
            true
        } else {
            false
        }
    }

    pub fn update_record_text(&self, id: &str, new_text: &str) -> bool {
        let mut history = self.get_history();
        if let Some(record) = history.iter_mut().find(|r| r.id == id) {
            record.text = new_text.to_string();
            // Optional: Re-calculate words if we want, but keeping it simple for now
            // record.words = new_text.split_whitespace().count() as u32;
            self.save_history(&history);
            true
        } else {
            false
        }
    }
}
