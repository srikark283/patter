#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod asr;
mod audio;
mod commands;
mod db;
mod diarize;
mod meeting;
mod models;
mod ollama;
mod paste;
mod recording;
mod state;
mod tray;
mod vad;

use state::AppState;
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex};
use tauri::{Manager, WebviewUrl};
use tauri_plugin_autostart::ManagerExt;
use tauri::tray::TrayIconBuilder;
use tauri_nspanel::{tauri_panel, PanelBuilder, PanelLevel};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

tauri_panel! {
    panel!(HUDPanel {
        config: {
            can_become_key_window: false,
            is_floating_panel: true
        }
    })
}

fn main() {
    let (tx, shared_config) = audio::capture::init_audio();

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_nspanel::init())
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Background update check on launch: notify only — download and
            // install happen when the user asks (install_update command).
            let update_handle = app.handle().clone();
            let check_updates = move || {
                tauri::async_runtime::spawn(async move {
                    use tauri::Emitter;
                    use tauri_plugin_updater::UpdaterExt;
                    let updater = match update_handle.updater() {
                        Ok(u) => u,
                        Err(e) => return eprintln!("[update] updater init failed: {}", e),
                    };
                    match updater.check().await {
                        Ok(Some(update)) => {
                            println!("[update] v{} available", update.version);
                            let _ = update_handle
                                .emit("patter://update_available", update.version.clone());
                        }
                        Ok(None) => println!("[update] up to date"),
                        Err(e) => eprintln!("[update] check failed: {}", e),
                    }
                });
            };

            let model_manager = models::registry::ModelManager::new(app.handle())?;
            let db_instance = db::Db::new(app.handle());
            let settings = db_instance.get_settings();

            let mut initial_engine: Option<Box<dyn asr::ASREngine>> = None;
            let mut initial_engine_id: Option<String> = None;

            if let Some(ref engine_id) = settings.active_engine_id {
                if model_manager.is_downloaded(engine_id) {
                    if let Some(kind) = model_manager.get_engine_kind(engine_id) {
                        match kind {
                            models::registry::EngineKind::Whisper => {
                                if let Some(path) = model_manager.variant_file_path(engine_id) {
                                    if let Ok(whisper) = asr::whisper::WhisperEngine::new(&path.to_string_lossy()) {
                                        initial_engine = Some(Box::new(whisper));
                                        initial_engine_id = Some(engine_id.clone());
                                    }
                                }
                            }
                            models::registry::EngineKind::Parakeet => {
                                if let Some(path) = model_manager.variant_dir(engine_id) {
                                    if let Ok(parakeet) = asr::parakeet::ParakeetEngine::new(&path.to_string_lossy()) {
                                        initial_engine = Some(Box::new(parakeet));
                                        initial_engine_id = Some(engine_id.clone());
                                    }
                                }
                            }
                            models::registry::EngineKind::Diarization => {}
                        }
                    }
                }
            } else if model_manager.is_downloaded("whisper-base") {
                if let Some(whisper_path) = model_manager.variant_file_path("whisper-base") {
                    if let Ok(whisper) = asr::whisper::WhisperEngine::new(&whisper_path.to_string_lossy()) {
                        initial_engine = Some(Box::new(whisper));
                        initial_engine_id = Some("whisper-base".to_string());
                    }
                }
            }
            
            // Apply autostart preference
            let autolaunch = app.autolaunch();
            if settings.autostart {
                let _ = autolaunch.enable();
            } else {
                let _ = autolaunch.disable();
            }

            let hotkey_str = settings.hotkey.clone();
            let hud_position_str = settings.hud_position.clone();
            let auto_update = settings.auto_update;

            let app_state = AppState {
                captured: Arc::new(Mutex::new(Vec::new())),
                audio_tx: tx,
                device_config: shared_config.clone(),
                is_recording: Arc::new(AtomicBool::new(false)),
                is_paused: Arc::new(AtomicBool::new(false)),
                frontmost_app: Arc::new(Mutex::new(None)),
                meeting_captured: Arc::new(Mutex::new(Vec::new())),
                is_meeting_recording: Arc::new(AtomicBool::new(false)),
                engine: Arc::new(Mutex::new(initial_engine)),
                active_engine_id: Arc::new(Mutex::new(initial_engine_id)),
                model_manager,
                settings: Arc::new(Mutex::new(settings)),
            };

            app.manage(app_state);

            // Tray needs AppState (history, model list, pause flag) to build its menu.
            let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png")).unwrap();
            let _tray = TrayIconBuilder::with_id(tray::TRAY_ID)
                .icon(tray_icon)
                .menu(&tray::build_menu(app.handle())?)
                .on_menu_event(|app, event| tray::on_menu_event(app, event))
                .build(app)?;

            let shortcut = hotkey_str.parse::<tauri_plugin_global_shortcut::Shortcut>()
                .unwrap_or_else(|_| "Alt+Space".parse().unwrap());
            let _ = app.global_shortcut().register(shortcut);

            let panel = PanelBuilder::<_, HUDPanel>::new(app.handle(), "main")
                .url(WebviewUrl::App("hud.html".into()))
                .level(PanelLevel::Floating)
                .transparent(true)
                .with_window(|window| {
                    window
                        .transparent(true)
                        .decorations(false)
                        // macOS draws an NSWindow shadow around the opaque content of a
                        // transparent window — shows up as a dark ring around the pill.
                        .shadow(false)
                        .always_on_top(true)
                        .resizable(false)
                        .inner_size(320.0, 88.0)
                })
                .build()?;

            let window = app.get_webview_window("main").unwrap();
            if let Some(monitor) = window.primary_monitor()? {
                let size = monitor.size();
                let window_size = window.outer_size()?;
                let multiplier = match hud_position_str.as_str() {
                    "top" => 0.02,
                    _ => 0.90,
                };
                let y = (size.height as f64 * multiplier) as i32;
                let x = ((size.width as i32) - (window_size.width as i32)) / 2;
                window.set_position(tauri::PhysicalPosition::new(x, y))?;
            }

            // No OS vibrancy here: apply_vibrancy fills the whole 320x88 window
            // rect (rounded), but the visible pill (Hud.tsx) is a smaller shape
            // centered inside it — real vibrancy would show as a big oval behind
            // the small pill. CSS-only glass (bg-graphite + backdrop-blur) instead.
            panel.show();

            if auto_update {
                check_updates();
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if window.label() == "dashboard" {
                if let tauri::WindowEvent::Destroyed = event {
                    let _ = window
                        .app_handle()
                        .set_activation_policy(tauri::ActivationPolicy::Accessory);
                }
            }
        })
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    let state = app.state::<AppState>();
                    let push_to_talk = state.settings.lock().unwrap().push_to_talk;
                    match event.state {
                        ShortcutState::Pressed => {
                            if state.is_recording.load(Ordering::SeqCst) {
                                // In push-to-talk, repeated Pressed events while
                                // holding the key must not stop the recording.
                                if !push_to_talk {
                                    recording::stop_and_transcribe(app);
                                }
                            } else if !state.is_paused.load(Ordering::SeqCst) {
                                recording::start_recording(app);
                            }
                        }
                        ShortcutState::Released => {
                            if push_to_talk && state.is_recording.load(Ordering::SeqCst) {
                                recording::stop_and_transcribe(app);
                            }
                        }
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            commands::download_model,
            commands::delete_model,
            commands::is_model_downloaded,
            commands::set_engine,
            commands::get_active_engine,
            commands::get_settings,
            commands::update_settings,
            commands::get_microphones,
            commands::get_stats,
            commands::get_history,
            commands::clear_history,
            commands::delete_history_record,
            commands::update_history_record,
            commands::cancel_dictation,
            commands::open_dashboard,
            commands::list_ollama_models,
            commands::start_meeting_recording,
            commands::stop_meeting_recording,
            commands::is_meeting_recording,
            commands::get_meetings,
            commands::delete_meeting,
            commands::accessibility_trusted,
            commands::open_accessibility_settings,
            commands::restart_app,
            commands::check_update,
            commands::install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
