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
pub fn stop_meeting_recording(app: tauri::AppHandle) -> Result<(), String> {
    crate::meeting::stop_meeting(&app)
}

#[tauri::command]
pub fn is_meeting_recording(app: tauri::AppHandle) -> bool {
    app.state::<AppState>().is_meeting_recording.load(Ordering::SeqCst)
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
pub fn get_settings(app: tauri::AppHandle) -> db::Settings {
    app.state::<AppState>().settings.lock().unwrap().clone()
}

#[tauri::command]
pub fn update_settings(app: tauri::AppHandle, settings: db::Settings) -> Result<(), String> {
    let state = app.state::<AppState>();
    
    let mut current_settings = state.settings.lock().unwrap();
    let old_hotkey = current_settings.hotkey.clone();
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
    if app.get_webview_window("dashboard").is_none() {
        let window = tauri::WebviewWindowBuilder::new(&app, "dashboard", WebviewUrl::App("dashboard.html".into()))
            .title("Patter Dashboard")
            .inner_size(800.0, 600.0)
            .transparent(true)
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .build()
            .map_err(|e| e.to_string())?;
        let _ = apply_vibrancy(&window, NSVisualEffectMaterial::UnderWindowBackground, None, None);
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
