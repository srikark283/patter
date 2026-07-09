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
pub fn set_output_mode(app: tauri::AppHandle, mode: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    *state.output_mode.lock().unwrap() = mode;
    Ok(())
}

#[tauri::command]
pub async fn set_custom_prompt(app: tauri::AppHandle, prompt: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    *state.custom_prompt.lock().unwrap() = prompt;
    Ok(())
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
    *state.active_engine_id.lock().unwrap() = Some(id);
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
