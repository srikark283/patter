use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::fs;
use tauri::Manager;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct AppStats {
    pub total_words: u32,
    pub time_saved_seconds: u32,
    pub transcriptions_count: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TranscriptionRecord {
    pub id: String,
    pub timestamp_ms: u64,
    pub text: String,
    pub duration_seconds: f32,
    pub words: u32,
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
}
