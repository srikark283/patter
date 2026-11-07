use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::fs;

static MEETING_WRITE: std::sync::Mutex<()> = std::sync::Mutex::new(());
static RESTORE_COMPLETE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
const RESTORE_FILES: [&str; 3] = ["settings.json", "history.json", "meetings.json"];

#[derive(Serialize, Deserialize)]
struct RestoreJournal { stage: String, existed: [bool; 3] }

fn writable() -> std::io::Result<()> {
    if RESTORE_COMPLETE.load(std::sync::atomic::Ordering::SeqCst) { return Err(std::io::Error::other("Restart Patter to apply the restored backup before making changes")); }
    Ok(())
}

fn sync_dir(path: &std::path::Path) -> std::io::Result<()> {
    #[cfg(unix)] { fs::File::open(path)?.sync_all()?; }
    Ok(())
}

fn durable_write(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut options = fs::OpenOptions::new(); options.write(true).create(true).truncate(true);
    #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
    let mut file = options.open(path)?; file.write_all(bytes)?; file.sync_all()
}

static HISTORY_WRITE: std::sync::Mutex<()> = std::sync::Mutex::new(());
use tauri::Manager;
use std::time::{SystemTime, UNIX_EPOCH};

fn default_hud_position() -> String {
    "bottom".to_string()
}

fn default_play_sounds() -> bool {
    true
}

fn default_sound_theme() -> String {
    "pop".to_string()
}

fn default_trim_silence() -> bool {
    true
}

/// Minutes Ollama holds the cleanup model in memory after a request. Ollama's
/// own default is 5 minutes, which unloads the model between dictations and
/// makes the next hotkey pay a multi-second reload.
fn default_ollama_keep_alive_minutes() -> i32 {
    30
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Settings {
    pub hotkey: String,
    /// Toggles meeting recording start/stop. Empty = unset (no hotkey registered).
    #[serde(default)]
    pub meeting_hotkey: String,
    /// Command mode: grabs the frontmost app's selection, then records a spoken
    /// instruction to rewrite it with. Empty = unset (no hotkey registered).
    #[serde(default)]
    pub command_hotkey: String,
    /// Spoken prefix that turns an ordinary dictation into a command, so the
    /// feature works without a second hotkey. Empty = off. Matched
    /// phonetically against the first word(s), because a trigger word is
    /// exactly the kind of thing an ASR engine mangles.
    #[serde(default)]
    pub command_phrase: String,
    pub microphone: Option<String>,
    pub output_mode: String,
    pub custom_prompt: String,
    /// User-approved mishearings, keyed by the preferred dictionary spelling.
    #[serde(default)]
    pub dictionary_aliases: std::collections::BTreeMap<String, Vec<String>>,
    pub autostart: bool,
    pub language: String,
    pub silence_timeout_ms: u32,
    pub active_engine_id: Option<String>,
    #[serde(default)]
    pub llm_cleanup_enabled: bool,
    #[serde(default)]
    pub cleanup_provider: crate::inference::CleanupProvider,
    #[serde(default)]
    pub built_in_model: crate::inference::BuiltInModel,
    #[serde(default)]
    pub ollama_model: Option<String>,
    #[serde(default)]
    pub meeting_ollama_model: Option<String>,
    /// How long Ollama keeps the model resident. -1 holds it indefinitely,
    /// 0 unloads it as soon as the request finishes.
    #[serde(default = "default_ollama_keep_alive_minutes")]
    pub ollama_keep_alive_minutes: i32,
    #[serde(default = "default_hud_position")]
    pub hud_position: String,
    #[serde(default = "default_play_sounds")]
    pub play_sounds: bool,
    #[serde(default = "default_sound_theme")]
    pub sound_theme: String,
    #[serde(default = "default_trim_silence")]
    pub trim_silence: bool,
    /// Tuned for whispering in shared spaces: boosts quiet audio to a level the
    /// ASR model expects, tracks the room's noise floor instead of a fixed
    /// speech threshold, and keeps audio the VAD would otherwise throw away.
    #[serde(default)]
    pub whisper_mode: bool,
    /// False for fresh installs and installs predating onboarding.
    #[serde(default)]
    pub onboarding_done: bool,
    /// Hold hotkey to record, release to transcribe (vs press-to-toggle).
    #[serde(default)]
    pub push_to_talk: bool,
    /// Label speakers in meeting transcripts (needs diarization models).
    #[serde(default)]
    pub diarize_meetings: bool,
    /// ASR engine for meetings. None = whatever dictation is using. Room audio
    /// and close-mic dictation reward different models, and a meeting is a
    /// batch job that can afford a slower, more accurate one.
    #[serde(default)]
    pub meeting_engine_id: Option<String>,
    /// Per-app cleanup instructions, matched against the frontmost app name.
    #[serde(default)]
    pub app_profiles: Vec<AppProfile>,
    /// Check GitHub releases for updates on launch.
    #[serde(default = "default_auto_update")]
    pub auto_update: bool,
    /// Voice macro snippets
    #[serde(default)]
    pub snippets: Vec<Snippet>,
    /// Facts for RAG
    #[serde(default)]
    pub memories: Vec<MemoryFact>,
    /// Correction suggestions the user rejected, as "wrong→right" keys, so a
    /// dismissed one never comes back.
    #[serde(default)]
    pub dismissed_suggestions: Vec<String>,
    
    }

fn default_auto_update() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppProfile {
    /// Case-insensitive substring of the app name ("slack", "mail").
    pub app: String,
    /// Cleanup instruction supplied to the selected Patter model.
    pub prompt: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Snippet {
    pub trigger: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MemoryFact {
    pub id: String,
    pub content: String,
    #[serde(default)]
    pub embedding: Vec<f32>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            hotkey: "Alt+Space".to_string(),
            meeting_hotkey: "".to_string(),
            command_hotkey: "".to_string(),
            command_phrase: "".to_string(),
            microphone: None,
            output_mode: "type".to_string(),
            custom_prompt: "".to_string(),
            dictionary_aliases: Default::default(),
            autostart: true, // Default to true for system tray utilities
            language: "auto".to_string(),
            silence_timeout_ms: 1000,
            active_engine_id: None,
            llm_cleanup_enabled: false,
            cleanup_provider: crate::inference::CleanupProvider::default(),
            built_in_model: crate::inference::BuiltInModel::default(),
            ollama_model: None,
            meeting_ollama_model: None,
            ollama_keep_alive_minutes: default_ollama_keep_alive_minutes(),
            hud_position: default_hud_position(),
            play_sounds: default_play_sounds(),
            sound_theme: default_sound_theme(),
            trim_silence: default_trim_silence(),
            meeting_engine_id: None,
            whisper_mode: false,
            onboarding_done: false,
            push_to_talk: false,
            diarize_meetings: false,
            app_profiles: Vec::new(),
            auto_update: true,
            snippets: Vec::new(),
            memories: Vec::new(),
            dismissed_suggestions: Vec::new(),
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
    /// LLM cleanup time. 0 when cleanup is off, or for records predating this.
    #[serde(default)]
    pub cleanup_ms: u32,
    /// Stop-handler entry to output dispatch (the target app handles paste
    /// asynchronously). 0 for records predating this field.
    #[serde(default)]
    pub total_ms: u32,
    #[serde(default)]
    pub app_name: Option<String>,
    /// The transcript as the pipeline produced it, kept only once the user
    /// edits the record. Without it an edit destroys the very thing that makes
    /// it a correction — what the engine actually heard. `None` means never
    /// edited (or edited before this field existed).
    #[serde(default)]
    pub original_text: Option<String>,
    #[serde(default)]
    pub favorite: bool,
    /// None for legacy records; dispatched never claims target-app insertion.
    #[serde(default)]
    pub output_status: Option<String>,
    #[serde(default)]
    pub recovery_dismissed: bool,
    }

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Backup {
    pub version: String,
    pub exported_at_ms: u64,
    pub settings: Settings,
    pub history: Vec<TranscriptionRecord>,
    pub meetings: Vec<MeetingRecord>,
}

pub fn lock_data_directory(app: &tauri::AppHandle) -> std::io::Result<()> {
    static LOCK: std::sync::OnceLock<fs::File> = std::sync::OnceLock::new();
    let directory = app.path().app_data_dir().map_err(std::io::Error::other)?;
    fs::create_dir_all(&directory)?;
    #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?; }
    let file = acquire_data_lock(&directory)?;
    LOCK.set(file).map_err(|_| std::io::Error::other("Data directory already locked"))
}

fn acquire_data_lock(directory: &std::path::Path) -> std::io::Result<fs::File> {
    let mut options = fs::OpenOptions::new(); options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
    let file = options.open(directory.join(".patter.lock"))?;
    file.try_lock().map_err(|_| std::io::Error::other("Another Patter process is using this data directory. Open the running app instead."))?;
    Ok(file)
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

    /// Roll back an interrupted import before loading settings or starting workers.
    pub fn recover_restore(&self) -> Result<(), String> {
        let path = self.data_dir.join(".restore-journal.json");
        if !path.exists() { return Ok(()); }
        let journal: RestoreJournal = serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        if !journal.stage.starts_with(".restore-") || journal.stage.bytes().any(|b| !(b.is_ascii_digit() || b".restore-".contains(&b))) {
            return Err("Invalid restore journal; original data retained for recovery".into());
        }
        let stage = self.data_dir.join(&journal.stage);
        for (index, name) in RESTORE_FILES.iter().enumerate() {
            let live = self.data_dir.join(name);
            if journal.existed[index] {
                let original = stage.join(format!("{name}.original"));
                let rollback = stage.join(format!("{name}.rollback"));
                fs::copy(original, &rollback).map_err(|e| e.to_string())?;
                fs::File::open(&rollback).and_then(|f| f.sync_all()).map_err(|e| e.to_string())?;
                fs::rename(rollback, live).map_err(|e| e.to_string())?;
            } else if let Err(error) = fs::remove_file(live) {
                if error.kind() != std::io::ErrorKind::NotFound { return Err(error.to_string()); }
            }
        }
        sync_dir(&self.data_dir).map_err(|e| e.to_string())?;
        fs::remove_file(path).map_err(|e| e.to_string())?;
        sync_dir(&self.data_dir).map_err(|e| e.to_string())?;
        let _ = fs::remove_dir_all(stage);
        Ok(())
    }

    /// Journal originals durably before replacing any live file.
    pub fn restore_backup(&self, backup: &Backup) -> Result<(), String> {
        let _history = HISTORY_WRITE.lock().map_err(|e| e.to_string())?;
        let _meetings = MEETING_WRITE.lock().map_err(|e| e.to_string())?;
        self.recover_restore()?;
        let content = [serde_json::to_vec_pretty(&backup.settings), serde_json::to_vec_pretty(&backup.history), serde_json::to_vec_pretty(&backup.meetings)];
        let suffix = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
        let stage_name = format!(".restore-{}-{suffix}", std::process::id());
        let stage = self.data_dir.join(&stage_name);
        fs::create_dir(&stage).map_err(|e| e.to_string())?;
        let journal_path = self.data_dir.join(".restore-journal.json");
        let result = (|| -> Result<(), String> {
            let mut existed = [false; 3];
            for (index, name) in RESTORE_FILES.iter().enumerate() {
                let live = self.data_dir.join(name);
                match fs::symlink_metadata(&live) {
                    Ok(metadata) => {
                        if !metadata.is_file() { return Err(format!("Cannot restore over non-file {name}")); }
                        let original = stage.join(format!("{name}.original"));
                        fs::copy(&live, &original).map_err(|e| e.to_string())?;
                        fs::File::open(original).and_then(|f| f.sync_all()).map_err(|e| e.to_string())?;
                        existed[index] = true;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
                    Err(error) => return Err(error.to_string()),
                }
                durable_write(&stage.join(name), content[index].as_ref().map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            }
            sync_dir(&stage).map_err(|e| e.to_string())?;
            let journal = RestoreJournal { stage: stage_name, existed };
            let temporary = self.data_dir.join(".restore-journal.tmp");
            durable_write(&temporary, &serde_json::to_vec(&journal).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            fs::rename(temporary, &journal_path).map_err(|e| e.to_string())?;
            sync_dir(&self.data_dir).map_err(|e| e.to_string())?;
            for name in RESTORE_FILES { fs::rename(stage.join(name), self.data_dir.join(name)).map_err(|e| e.to_string())?; }
            sync_dir(&self.data_dir).map_err(|e| e.to_string())?;
            fs::remove_file(&journal_path).map_err(|e| e.to_string())?;
            sync_dir(&self.data_dir).map_err(|e| e.to_string())?;
            Ok(())
        })();
        if let Err(error) = result {
            self.recover_restore().map_err(|rollback| format!("Restore failed: {error}; recovery failed: {rollback}. Keep {}", stage.display()))?;
            let _ = fs::remove_dir_all(stage);
            return Err(error);
        }
        let _ = fs::remove_dir_all(stage);
        Ok(())
    }

    pub fn require_restart_after_restore(&self) { RESTORE_COMPLETE.store(true, std::sync::atomic::Ordering::SeqCst); }

    fn atomic_write(&self, name: &str, content: &[u8]) -> std::io::Result<()> {
        writable()?;
        let suffix = SystemTime::now().duration_since(UNIX_EPOCH).map_err(std::io::Error::other)?.as_nanos();
        let temporary = self.data_dir.join(format!(".{name}-{}-{suffix}.tmp", std::process::id()));
        let result = durable_write(&temporary, content).and_then(|_| fs::rename(&temporary, self.data_dir.join(name))).and_then(|_| sync_dir(&self.data_dir));
        if result.is_err() { let _ = fs::remove_file(temporary); }
        result
    }

    pub fn get_settings(&self) -> Settings {
        let path = self.data_dir.join("settings.json");
        if let Ok(content) = fs::read_to_string(path) {
            crate::inference::load_settings(&content).unwrap_or_default()
        } else {
            Settings::default()
        }
    }

    pub fn save_settings(&self, settings: &Settings) -> std::io::Result<()> {
        writable()?;
        let content = serde_json::to_vec_pretty(settings).map_err(std::io::Error::other)?;
        self.atomic_write("settings.json", &content)
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
        if writable().is_err() { return; }
        if let Ok(content) = serde_json::to_vec_pretty(stats) {
            if self.atomic_write("stats.json", &content).is_err() { eprintln!("Could not save statistics"); }
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

    fn write_history(&self, history: &[TranscriptionRecord]) -> Result<(), String> {
        let content = serde_json::to_vec_pretty(history).map_err(|e| e.to_string())?;
        self.atomic_write("history.json", &content).map_err(|e| e.to_string())
    }

    pub fn save_history(&self, history: &[TranscriptionRecord]) {
        if let Err(error) = self.write_history(history) { eprintln!("Could not save history: {error}"); }
    }

    pub fn add_record(&self, mut record: TranscriptionRecord) {
        let _guard = HISTORY_WRITE.lock().unwrap();
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
    
    pub fn set_record_flags(&self, id: &str, favorite: Option<bool>, recovery_dismissed: Option<bool>) -> Result<(), String> {
        let _guard = HISTORY_WRITE.lock().map_err(|e| e.to_string())?;
        let mut history = self.get_history();
        let record = history.iter_mut().find(|record| record.id == id).ok_or("Transcript no longer exists")?;
        if let Some(value) = favorite { record.favorite = value; }
        if let Some(value) = recovery_dismissed { record.recovery_dismissed = value; }
        self.write_history(&history)
    }

    pub fn clear_history(&self) {
        let _guard = HISTORY_WRITE.lock().unwrap();
        self.save_history(&[]);
        // Keep stats untouched, just clear history log
    }

    pub fn delete_record(&self, id: &str) -> bool {
        let _guard = HISTORY_WRITE.lock().unwrap();
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
        if writable().is_err() { return; }
        if let Ok(content) = serde_json::to_vec_pretty(meetings) {
            if self.atomic_write("meetings.json", &content).is_err() { eprintln!("Could not save meetings"); }
        }
    }

    pub fn add_meeting(&self, mut record: MeetingRecord) {
        let _guard = MEETING_WRITE.lock().unwrap();
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

    /// Edit the user-correctable fields of a meeting (title, transcript).
    pub fn update_meeting(&self, id: &str, title: &str, transcript: &str) -> bool {
        let _guard = MEETING_WRITE.lock().unwrap();
        let mut meetings = self.get_meetings();
        let Some(meeting) = meetings.iter_mut().find(|m| m.id == id) else {
            return false;
        };
        meeting.title = title.to_string();
        meeting.transcript = transcript.to_string();
        self.save_meetings(&meetings);
        true
    }

    pub fn update_meeting_action_items(&self, id: &str, action_items: Vec<String>) -> bool {
        let _guard = MEETING_WRITE.lock().unwrap();
        let mut meetings = self.get_meetings();
        let Some(meeting) = meetings.iter_mut().find(|m| m.id == id) else {
            return false;
        };
        meeting.action_items = action_items;
        self.save_meetings(&meetings);
        true
    }

    pub fn update_meeting_analysis(&self, id: &str, analysis: crate::ollama::MeetingAnalysis) -> bool {
        let _guard = MEETING_WRITE.lock().unwrap();
        let mut meetings = self.get_meetings();
        let Some(meeting) = meetings.iter_mut().find(|m| m.id == id) else {
            return false;
        };
        meeting.summary = analysis.summary;
        meeting.minutes = analysis.minutes;
        meeting.decisions = analysis.decisions;
        meeting.action_items = analysis.action_items;
        self.save_meetings(&meetings);
        true
    }

    pub fn delete_meeting(&self, id: &str) -> bool {
        let _guard = MEETING_WRITE.lock().unwrap();
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
        let _guard = HISTORY_WRITE.lock().unwrap();
        let mut history = self.get_history();
        if let Some(record) = history.iter_mut().find(|r| r.id == id) {
            // Set once, on the first edit only. A second edit must not overwrite
            // it with the first edit's text — the pipeline's own output is what
            // makes the pair a correction, and it exists exactly once.
            if record.original_text.is_none() && record.text != new_text {
                record.original_text = Some(record.text.clone());
            }
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

#[cfg(test)]
mod history_metadata_tests {
    use super::*;

    fn legacy_record() -> TranscriptionRecord {
        serde_json::from_str(r#"{"id":"old","timestamp_ms":1,"text":"Keep my words","duration_seconds":1.0,"words":3}"#).unwrap()
    }

    #[test]
    fn only_one_process_can_own_the_data_directory() {
        let directory = std::env::temp_dir().join(format!("patter-lock-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir(&directory).unwrap();
        let lock = acquire_data_lock(&directory).unwrap();
        assert!(acquire_data_lock(&directory).is_err());
        drop(lock);
        let next = acquire_data_lock(&directory).unwrap(); drop(next);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn interrupted_restore_recovers_originals_on_restart() {
        let dir = std::env::temp_dir().join(format!("patter-journal-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let stage = dir.join(".restore-123-456"); fs::create_dir_all(&stage).unwrap();
        fs::write(stage.join("settings.json.original"), b"original settings").unwrap();
        fs::write(stage.join("history.json.original"), b"original history").unwrap();
        fs::write(dir.join("settings.json"), b"partly restored").unwrap();
        fs::write(dir.join("meetings.json"), b"new file").unwrap();
        let journal = RestoreJournal { stage:".restore-123-456".into(), existed:[true,true,false] };
        fs::write(dir.join(".restore-journal.json"), serde_json::to_vec(&journal).unwrap()).unwrap();
        let db = Db { data_dir:dir.clone() }; db.recover_restore().unwrap();
        assert_eq!(fs::read(dir.join("settings.json")).unwrap(), b"original settings");
        assert_eq!(fs::read(dir.join("history.json")).unwrap(), b"original history");
        assert!(!dir.join("meetings.json").exists()); assert!(!stage.exists());
        db.recover_restore().unwrap();
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn restore_stages_all_files_before_replacing_live_data() {
        let dir = std::env::temp_dir().join(format!("patter-restore-test-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&dir).unwrap();
        let db = Db { data_dir: dir.clone() };
        db.save_settings(&Settings::default()).unwrap();
        let original = fs::read(dir.join("settings.json")).unwrap();
        fs::create_dir(dir.join("history.json")).unwrap();
        let mut settings = Settings::default();
        settings.hotkey = "Super+J".into();
        let backup = Backup { version: "test".into(), exported_at_ms: 0, settings, history: vec![legacy_record()], meetings: vec![] };
        assert!(db.restore_backup(&backup).is_err());
        assert_eq!(fs::read(dir.join("settings.json")).unwrap(), original);
        fs::remove_dir(dir.join("history.json")).unwrap();
        db.restore_backup(&backup).unwrap();
        assert_eq!(db.get_settings().hotkey, "Super+J");
        assert_eq!(db.get_history()[0].text, "Keep my words");
        assert!(db.get_meetings().is_empty());
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 3);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn old_transcripts_keep_unknown_output_status() {
        let record = legacy_record();
        assert!(!record.favorite);
        assert_eq!(record.output_status, None);
        assert!(!record.recovery_dismissed);
    }

    #[test]
    fn flags_round_trip_without_changing_text_or_output_evidence() {
        let dir = std::env::temp_dir().join(format!("patter-history-test-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&dir).unwrap();
        let db = Db { data_dir: dir.clone() };
        let mut record = legacy_record();
        record.output_status = Some("failed".into());
        db.save_history(&[record]);
        db.set_record_flags("old", Some(true), Some(true)).unwrap();
        let saved = db.get_history().remove(0);
        assert!(saved.favorite);
        assert!(saved.recovery_dismissed);
        assert_eq!(saved.text, "Keep my words");
        assert_eq!(saved.output_status.as_deref(), Some("failed"));
        assert!(db.set_record_flags("missing", Some(true), None).is_err());
        assert_eq!(db.get_history().len(), 1);
        fs::remove_dir_all(dir).unwrap();
    }
}
