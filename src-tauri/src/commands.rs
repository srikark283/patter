use crate::asr;
use crate::db;
use crate::models;
use crate::recording;
use crate::state::AppState;
use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager, WebviewUrl};
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

#[tauri::command]
pub async fn download_model(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let app_handle = app.clone();
    let progress_id = id.clone();

    state.model_manager.download_variant(&id, move |pct| {
        let _ = app_handle.emit("download_progress", models::registry::DownloadProgress {
            id: progress_id.clone(),
            pct,
        });
    }).await.map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn is_model_downloaded(app: tauri::AppHandle, id: String) -> bool {
    app.state::<AppState>().model_manager.is_downloaded(&id)
}

#[tauri::command]
pub fn delete_model(app: tauri::AppHandle, id: String) -> Result<(), String> {
    app.state::<AppState>().model_manager.delete_variant(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_ollama_models() -> Result<Vec<String>, String> {
    crate::ollama::list_models()
}

#[tauri::command]
pub fn start_meeting_recording(app: tauri::AppHandle) -> Result<(), String> {
    crate::meeting::start_meeting(&app)
}

#[tauri::command]
pub fn stop_meeting_recording(app: tauri::AppHandle, num_speakers: Option<i32>) -> Result<(), String> {
    crate::meeting::stop_meeting(&app, num_speakers)
}

#[tauri::command]
pub fn cancel_meeting_recording(app: tauri::AppHandle) -> Result<(), String> {
    crate::meeting::cancel_meeting(&app)
}

#[tauri::command]
pub fn is_meeting_recording(app: tauri::AppHandle) -> bool {
    app.state::<AppState>().is_meeting_recording.load(Ordering::SeqCst)
}

/// Wall-clock start (ms since epoch) of the current meeting recording, so a
/// view that mounts mid-meeting can compute the same elapsed time the HUD
/// shows instead of starting its own counter from 0.
#[tauri::command]
pub fn get_meeting_start_ms(app: tauri::AppHandle) -> Option<u64> {
    let state = app.state::<AppState>();
    if state.is_meeting_recording.load(Ordering::SeqCst) {
        Some(state.meeting_start_ms.load(Ordering::SeqCst))
    } else {
        None
    }
}

#[tauri::command]
pub fn get_meetings(app: tauri::AppHandle) -> Vec<db::MeetingRecord> {
    db::Db::new(&app).get_meetings()
}

#[tauri::command]
pub fn delete_meeting(app: tauri::AppHandle, id: String) -> Result<bool, String> {
    Ok(db::Db::new(&app).delete_meeting(&id))
}

#[tauri::command]
pub fn update_meeting(
    app: tauri::AppHandle,
    id: String,
    title: String,
    transcript: String,
) -> Result<bool, String> {
    Ok(db::Db::new(&app).update_meeting(&id, &title, &transcript))
}

#[tauri::command]
pub fn regenerate_meeting_summary(
    app: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    let meetings = db::Db::new(&app).get_meetings();
    let meeting = meetings.into_iter().find(|m| m.id == id).ok_or("Meeting not found")?;
    
    let state = app.state::<AppState>();
    let settings = state.settings.lock().unwrap().clone();
    let meeting_model = settings.meeting_ollama_model.or(settings.ollama_model);
    let model = meeting_model.ok_or("No Ollama model selected")?;
    
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let _ = app_handle.emit("patter://meeting_state", "summarizing");
        let transcript = meeting.transcript.clone();
        let meeting_id = meeting.id.clone();
        
        match crate::ollama::summarize_meeting(&model, &transcript, |current, total| {
            if total > 1 {
                if current < total {
                    let _ = app_handle.emit("patter://meeting_progress", format!("Summarizing part {}/{}", current, total - 1));
                } else {
                    let _ = app_handle.emit("patter://meeting_progress", "Synthesizing final summary".to_string());
                }
            }
        }) {
            Ok(analysis) => {
                db::Db::new(&app_handle).update_meeting_analysis(&meeting_id, analysis);
                let _ = app_handle.emit("patter://meetings_updated", ());
            }
            Err(e) => {
                let _ = app_handle.emit("patter://meeting_state", format!("error: summary failed ({})", e));
            }
        }
        let _ = app_handle.emit("patter://meeting_state", "idle");
    });
    
    Ok(())
}

#[tauri::command]
pub fn update_meeting_action_items(
    app: tauri::AppHandle,
    id: String,
    action_items: Vec<String>,
) -> Result<bool, String> {
    Ok(db::Db::new(&app).update_meeting_action_items(&id, action_items))
}

#[tauri::command]
pub fn get_settings(app: tauri::AppHandle) -> db::Settings {
    app.state::<AppState>().settings.lock().unwrap().clone()
}

#[tauri::command]
pub fn update_settings(app: tauri::AppHandle, settings: db::Settings) -> Result<(), String> {
    let state = app.state::<AppState>();
    
    let mut current_settings = state.settings.lock().unwrap();
    let old_hotkey = current_settings.hotkey.clone();
    let old_meeting_hotkey = current_settings.meeting_hotkey.clone();
    let old_hud_position = current_settings.hud_position.clone();
    
    // Apply autostart if changed
    if settings.autostart != current_settings.autostart {
        use tauri_plugin_autostart::ManagerExt;
        let autolaunch = app.autolaunch();
        if settings.autostart {
            let _ = autolaunch.enable();
        } else {
            let _ = autolaunch.disable();
        }
    }
    
    *current_settings = settings.clone();
    db::Db::new(&app).save_settings(&settings);
    
    // If hotkey changed, update global shortcut
    if old_hotkey != settings.hotkey {
        use tauri_plugin_global_shortcut::GlobalShortcutExt;
        
        let manager = app.global_shortcut();
        if let Ok(old_shortcut) = old_hotkey.parse::<tauri_plugin_global_shortcut::Shortcut>() {
            let _ = manager.unregister(old_shortcut);
        }
        
        if let Ok(new_shortcut) = settings.hotkey.parse::<tauri_plugin_global_shortcut::Shortcut>() {
            let _ = manager.register(new_shortcut);
        }
    }

    // Same dance for the meeting hotkey, which is a second, independent
    // registration (may be empty — no hotkey bound).
    if old_meeting_hotkey != settings.meeting_hotkey {
        use tauri_plugin_global_shortcut::GlobalShortcutExt;

        let manager = app.global_shortcut();
        if !old_meeting_hotkey.is_empty() {
            if let Ok(old_shortcut) = old_meeting_hotkey.parse::<tauri_plugin_global_shortcut::Shortcut>() {
                let _ = manager.unregister(old_shortcut);
            }
        }
        if !settings.meeting_hotkey.is_empty() {
            if let Ok(new_shortcut) = settings.meeting_hotkey.parse::<tauri_plugin_global_shortcut::Shortcut>() {
                let _ = manager.register(new_shortcut);
            }
        }
    }

    if old_hud_position != settings.hud_position {
        if let Some(window) = app.get_webview_window("main") {
            if let Ok(Some(monitor)) = window.primary_monitor() {
                let size = monitor.size();
                let window_size = window.outer_size().unwrap_or_default();
                let multiplier = match settings.hud_position.as_str() {
                    "top" => 0.02,
                    _ => 0.90,
                };
                let y = (size.height as f64 * multiplier) as i32;
                let x = ((size.width as i32) - (window_size.width as i32)) / 2;
                let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn get_microphones() -> Result<Vec<String>, String> {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    let devices = host.input_devices().map_err(|e| e.to_string())?;
    
    let mut names = Vec::new();
    for device in devices {
        if let Ok(name) = device.name() {
            names.push(name);
        }
    }
    Ok(names)
}

#[tauri::command]
pub fn get_stats(app: tauri::AppHandle) -> db::AppStats {
    db::Db::new(&app).get_stats()
}

#[tauri::command]
pub fn get_ollama_embedding(model: String, prompt: String) -> Result<Vec<f32>, String> {
    crate::ollama::get_embedding(&model, &prompt)
}

#[tauri::command]
pub fn get_history(app: tauri::AppHandle) -> Vec<db::TranscriptionRecord> {
    db::Db::new(&app).get_history()
}

#[tauri::command]
pub fn clear_history(app: tauri::AppHandle) {
    db::Db::new(&app).clear_history()
}

#[tauri::command]
pub fn delete_history_record(app: tauri::AppHandle, id: String) -> Result<bool, String> {
    Ok(db::Db::new(&app).delete_record(&id))
}

#[tauri::command]
pub fn update_history_record(app: tauri::AppHandle, id: String, text: String) -> Result<bool, String> {
    Ok(db::Db::new(&app).update_record_text(&id, &text))
}

#[tauri::command]
pub async fn export_data(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;

    let db = db::Db::new(&app);
    let backup = db::Backup {
        version: env!("CARGO_PKG_VERSION").to_string(),
        exported_at_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
        settings: db.get_settings(),
        history: db.get_history(),
        meetings: db.get_meetings(),
    };
    let json = serde_json::to_string_pretty(&backup).map_err(|e| e.to_string())?;

    let Some(file_path) = app
        .dialog()
        .file()
        .set_file_name("patter-backup.json")
        .add_filter("JSON", &["json"])
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let path = file_path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn import_data(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;

    let Some(file_path) = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .blocking_pick_file()
    else {
        return Ok(false);
    };
    let path = file_path.into_path().map_err(|e| e.to_string())?;
    let json = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let backup: db::Backup = serde_json::from_str(&json).map_err(|e| e.to_string())?;

    let db = db::Db::new(&app);
    db.save_settings(&backup.settings);
    db.save_history(&backup.history);
    db.save_meetings(&backup.meetings);
    let _ = app.emit("patter://db_updated", ());
    Ok(true)
}

#[tauri::command]
pub fn is_recording(app: tauri::AppHandle) -> bool {
    app.state::<AppState>().is_recording.load(Ordering::SeqCst)
}

#[tauri::command]
pub fn cancel_dictation(app: tauri::AppHandle) {
    recording::cancel(&app);
}

#[tauri::command]
pub fn set_engine(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mm = &state.model_manager;

    let engine: Box<dyn asr::ASREngine> = match mm.get_engine_kind(&id) {
        Some(models::registry::EngineKind::Whisper) => {
            let path = mm.variant_file_path(&id).ok_or("Unknown engine")?;
            Box::new(asr::whisper::WhisperEngine::new(&path.to_string_lossy()).map_err(|e| e.to_string())?)
        },
        Some(models::registry::EngineKind::Parakeet) => {
            let dir = mm.variant_dir(&id).ok_or("Unknown engine")?;
            Box::new(asr::parakeet::ParakeetEngine::new(&dir.to_string_lossy()).map_err(|e| e.to_string())?)
        },
        Some(models::registry::EngineKind::Diarization) => {
            return Err("Not an ASR engine".into())
        },
        None => return Err("Unknown engine".into())
    };

    *state.engine.lock().unwrap() = Some(engine);
    *state.active_engine_id.lock().unwrap() = Some(id.clone());

    let mut settings = state.settings.lock().unwrap();
    settings.active_engine_id = Some(id);
    crate::db::Db::new(&app).save_settings(&settings);
    drop(settings);

    crate::tray::refresh(&app);
    Ok(())
}

#[tauri::command]
pub fn get_active_engine(app: tauri::AppHandle) -> Option<String> {
    app.state::<AppState>().active_engine_id.lock().unwrap().clone()
}

#[tauri::command]
pub fn open_dashboard(app: tauri::AppHandle) -> Result<(), String> {
    // Menubar app normally hides from the Dock; show while the dashboard is
    // open (reverted on window destroy in main.rs).
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    // Re-apply after the Dock tile exists — a set made under Accessory can be dropped.
    apply_dock_icon();

    if app.get_webview_window("dashboard").is_none() {
        #[allow(unused_mut)]
        let mut builder = tauri::WebviewWindowBuilder::new(&app, "dashboard", WebviewUrl::App("dashboard.html".into()))
            .title("Patter Dashboard")
            .inner_size(800.0, 600.0)
            .transparent(true);

        #[cfg(target_os = "macos")]
        {
            builder = builder
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true);
        }

        let _window = builder.build().map_err(|e| e.to_string())?;

        #[cfg(target_os = "macos")]
        let _ = apply_vibrancy(&_window, NSVisualEffectMaterial::UnderWindowBackground, None, None);
    } else {
        app.get_webview_window("dashboard").unwrap().set_focus().unwrap();
    }
    Ok(())
}

#[tauri::command]
pub fn accessibility_trusted() -> bool {
    crate::paste::accessibility_trusted()
}

#[tauri::command]
pub fn open_accessibility_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_permission_status() -> crate::permissions::PermissionStatus {
    crate::permissions::get_status()
}

#[tauri::command]
pub fn open_input_monitoring_settings() -> Result<(), String> {
    crate::permissions::open_input_monitoring_settings()
}

#[tauri::command]
pub fn open_microphone_settings() -> Result<(), String> {
    crate::permissions::open_microphone_settings()
}

#[tauri::command]
pub fn open_notification_settings() -> Result<(), String> {
    crate::permissions::open_notification_settings()
}

#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

#[tauri::command]
pub async fn check_update(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| e.to_string())?;
    Ok(updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .map(|u| u.version))
}

#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("No update available")?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Dev runs a bare binary with no .app bundle, so the Dock shows the generic
/// exec icon; set it explicitly. Harmless in release (bundle icon wins).
/// Called at startup and again when the Dock presence appears, because a set
/// made while the policy is Accessory can be dropped.
#[cfg(target_os = "macos")]
pub fn apply_dock_icon() {
    use objc2::AllocAnyThread;
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::{MainThreadMarker, NSData};
    if let Some(mtm) = MainThreadMarker::new() {
        let data = NSData::with_bytes(include_bytes!("../icons/icon.png"));
        if let Some(img) = NSImage::initWithData(NSImage::alloc(), &data) {
            unsafe {
                NSApplication::sharedApplication(mtm).setApplicationIconImage(Some(&img));
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn apply_dock_icon() {}

#[tauri::command]
#[cfg(target_os = "macos")]
pub async fn get_app_icon(app_name: String) -> Result<Vec<u8>, String> {
    use std::process::Command;
    use std::fs;

    let safe_name: String = app_name
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect::<String>()
        .to_lowercase();
    
    if safe_name.is_empty() {
        return Err("Invalid app name".to_string());
    }

    let cache_dir = std::env::temp_dir().join("patter_icons");
    let _ = fs::create_dir_all(&cache_dir);
    let cache_path = cache_dir.join(format!("{}.png", safe_name));

    if cache_path.exists() {
        if let Ok(bytes) = fs::read(&cache_path) {
            return Ok(bytes);
        }
    }

    let mdfind_query = format!("kMDItemKind == 'Application' && (kMDItemFSName == '*{}*.app'cd || kMDItemAlternateNames == '*{}*.app'cd)", app_name, app_name);
    let output = Command::new("mdfind")
        .arg(&mdfind_query)
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let app_path = stdout.lines().next().ok_or("App not found")?;

    let info_plist_path = format!("{}/Contents/Info.plist", app_path);
    
    let plist_output = Command::new("/usr/libexec/PlistBuddy")
        .arg("-c")
        .arg("Print :CFBundleIconFile")
        .arg(&info_plist_path)
        .output()
        .map_err(|e| e.to_string())?;
    
    let mut icon_name = String::from_utf8_lossy(&plist_output.stdout).trim().to_string();
    if icon_name.is_empty() {
        icon_name = "AppIcon".to_string();
    }
    if !icon_name.ends_with(".icns") {
        icon_name.push_str(".icns");
    }

    let icns_path = format!("{}/Contents/Resources/{}", app_path, icon_name);

    let sips_output = Command::new("sips")
        .arg("-Z")
        .arg("128")
        .arg("-s")
        .arg("format")
        .arg("png")
        .arg(&icns_path)
        .arg("--out")
        .arg(&cache_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !sips_output.status.success() {
        return Err("Failed to extract icon".to_string());
    }

    if let Ok(bytes) = fs::read(&cache_path) {
        return Ok(bytes);
    }

    Err("Could not read generated png".to_string())
}

#[tauri::command]
#[cfg(not(target_os = "macos"))]
pub async fn get_app_icon(_app_name: String) -> Result<Vec<u8>, String> {
    // TODO: Implement Windows icon extraction using ExtractIconEx / GetForegroundWindow
    Err("Not implemented on Windows".to_string())
}
