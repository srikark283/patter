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
pub fn get_settings(app: tauri::AppHandle) -> db::Settings {
    app.state::<AppState>().settings.lock().unwrap().clone()
}

#[tauri::command]
pub fn update_settings(app: tauri::AppHandle, settings: db::Settings) -> Result<(), String> {
    let state = app.state::<AppState>();
    
    let mut current_settings = state.settings.lock().unwrap();
    let old_hotkey = current_settings.hotkey.clone();
    
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
        None => return Err("Unknown engine".into())
    };

    *state.engine.lock().unwrap() = Some(engine);
    *state.active_engine_id.lock().unwrap() = Some(id.clone());

    let mut settings = state.settings.lock().unwrap();
    settings.active_engine_id = Some(id);
    crate::db::Db::new(&app).save_settings(&settings);

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
            .build()
            .map_err(|e| e.to_string())?;
        let _ = apply_vibrancy(&window, NSVisualEffectMaterial::UnderWindowBackground, None, None);
    } else {
        app.get_webview_window("dashboard").unwrap().set_focus().unwrap();
    }
    Ok(())
}
