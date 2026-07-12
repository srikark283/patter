use std::sync::atomic::Ordering;

use tauri::menu::{
    CheckMenuItem, IconMenuItem, IsMenuItem, Menu, MenuItem, NativeIcon, PredefinedMenuItem,
    Submenu,
};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::state::AppState;
use crate::{commands, db, paste};

pub const TRAY_ID: &str = "patter-tray";

/// "whisper-base" -> "Whisper Base"
fn model_label(id: &str) -> String {
    id.split('-')
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn truncate_label(text: &str) -> String {
    let clean = text.trim().replace('\n', " ");
    if clean.chars().count() > 40 {
        let cut: String = clean.chars().take(40).collect();
        format!("{}…", cut)
    } else {
        clean
    }
}

pub fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let state = app.state::<AppState>();
    let paused = state.is_paused.load(Ordering::SeqCst);
    let meeting_active = state.is_meeting_recording.load(Ordering::SeqCst);
    let active_engine = state.active_engine_id.lock().unwrap().clone();
    let selected_mic = state.settings.lock().unwrap().microphone.clone();
    let downloaded = state.model_manager.downloaded_ids();
    let history = db::Db::new(app).get_history();

    let mut items: Vec<Box<dyn IsMenuItem<Wry>>> = Vec::new();

    items.push(Box::new(IconMenuItem::with_id_and_native_icon(
        app,
        "meeting",
        if meeting_active { "Stop Meeting Notes" } else { "Start Meeting Notes" },
        true,
        Some(NativeIcon::UserGroup),
        None::<&str>,
    )?));

    items.push(Box::new(IconMenuItem::with_id_and_native_icon(
        app,
        "copy-last",
        "Copy Last Transcription",
        !history.is_empty(),
        Some(NativeIcon::MultipleDocuments),
        None::<&str>,
    )?));

    items.push(Box::new(PredefinedMenuItem::separator(app)?));

    items.push(Box::new(IconMenuItem::with_id_and_native_icon(
        app,
        "pause",
        if paused { "Resume Dictation" } else { "Pause Dictation" },
        true,
        Some(if paused { NativeIcon::StatusUnavailable } else { NativeIcon::StatusAvailable }),
        None::<&str>,
    )?));

    items.push(Box::new(PredefinedMenuItem::separator(app)?));

    if !downloaded.is_empty() {
        let model_items: Vec<CheckMenuItem<Wry>> = downloaded
            .iter()
            .map(|id| {
                CheckMenuItem::with_id(
                    app,
                    format!("model:{}", id),
                    model_label(id),
                    true,
                    active_engine.as_deref() == Some(*id),
                    None::<&str>,
                )
            })
            .collect::<Result<_, _>>()?;
        let refs: Vec<&dyn IsMenuItem<Wry>> =
            model_items.iter().map(|i| i as &dyn IsMenuItem<Wry>).collect();
        items.push(Box::new(Submenu::with_items(app, "Speech Model", true, &refs)?));
    }

    if let Ok(mics) = commands::get_microphones() {
        let mut mic_items: Vec<CheckMenuItem<Wry>> = vec![CheckMenuItem::with_id(
            app,
            "mic:",
            "System Default",
            true,
            selected_mic.is_none(),
            None::<&str>,
        )?];
        for mic in &mics {
            mic_items.push(CheckMenuItem::with_id(
                app,
                format!("mic:{}", mic),
                mic,
                true,
                selected_mic.as_deref() == Some(mic),
                None::<&str>,
            )?);
        }
        let refs: Vec<&dyn IsMenuItem<Wry>> =
            mic_items.iter().map(|i| i as &dyn IsMenuItem<Wry>).collect();
        items.push(Box::new(Submenu::with_items(app, "Microphone", true, &refs)?));
    }

    if !history.is_empty() {
        let recent_items: Vec<MenuItem<Wry>> = history
            .iter()
            .take(3)
            .map(|r| {
                MenuItem::with_id(
                    app,
                    format!("recent:{}", r.id),
                    truncate_label(&r.text),
                    true,
                    None::<&str>,
                )
            })
            .collect::<Result<_, _>>()?;
        let refs: Vec<&dyn IsMenuItem<Wry>> =
            recent_items.iter().map(|i| i as &dyn IsMenuItem<Wry>).collect();
        items.push(Box::new(Submenu::with_items(
            app,
            "Recent Transcriptions",
            true,
            &refs,
        )?));
    }

    items.push(Box::new(PredefinedMenuItem::separator(app)?));

    items.push(Box::new(IconMenuItem::with_id_and_native_icon(
        app,
        "nav:preferences",
        "Settings…",
        true,
        Some(NativeIcon::PreferencesGeneral),
        None::<&str>,
    )?));
    items.push(Box::new(IconMenuItem::with_id_and_native_icon(
        app,
        "nav:history",
        "History",
        true,
        Some(NativeIcon::ListView),
        None::<&str>,
    )?));
    items.push(Box::new(IconMenuItem::with_id_and_native_icon(
        app,
        "nav:meetings",
        "Meetings",
        true,
        Some(NativeIcon::Bookmarks),
        None::<&str>,
    )?));

    items.push(Box::new(PredefinedMenuItem::separator(app)?));

    items.push(Box::new(MenuItem::with_id(
        app,
        "quit",
        "Quit Patter",
        true,
        Some("CmdOrCtrl+Q"),
    )?));

    let item_refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|i| i.as_ref()).collect();
    Menu::with_items(app, &item_refs)
}

/// Rebuild the tray menu to reflect current history/model/pause/meeting state.
pub fn refresh(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        match build_menu(app) {
            Ok(menu) => {
                let _ = tray.set_menu(Some(menu));
            }
            Err(e) => eprintln!("[tray] menu rebuild failed: {}", e),
        }
    }
}

/// Open the dashboard and switch it to `tab` (fire-and-forget; the delay
/// gives a freshly created window time to mount its event listener).
fn open_dashboard_tab(app: &AppHandle, tab: &str) {
    let existed = app.get_webview_window("dashboard").is_some();
    if commands::open_dashboard(app.clone()).is_err() {
        return;
    }
    let app = app.clone();
    let tab = tab.to_string();
    std::thread::spawn(move || {
        if !existed {
            std::thread::sleep(std::time::Duration::from_millis(600));
        }
        let _ = app.emit("patter://navigate", tab);
    });
}

pub fn on_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id.as_ref();
    match id {
        "quit" => std::process::exit(0),
        "meeting" => {
            let active = app
                .state::<AppState>()
                .is_meeting_recording
                .load(Ordering::SeqCst);
            let result = if active {
                crate::meeting::stop_meeting(app)
            } else {
                crate::meeting::start_meeting(app)
            };
            if let Err(e) = result {
                eprintln!("[tray] meeting toggle failed: {}", e);
            }
            refresh(app);
        }
        "copy-last" => {
            if let Some(record) = db::Db::new(app).get_history().first() {
                paste::copy_text(&record.text);
            }
        }
        "pause" => {
            let state = app.state::<AppState>();
            let now_paused = !state.is_paused.load(Ordering::SeqCst);
            state.is_paused.store(now_paused, Ordering::SeqCst);
            refresh(app);
        }
        _ => {
            if let Some(tab) = id.strip_prefix("nav:") {
                open_dashboard_tab(app, tab);
            } else if let Some(record_id) = id.strip_prefix("recent:") {
                let history = db::Db::new(app).get_history();
                if let Some(record) = history.iter().find(|r| r.id == record_id) {
                    paste::copy_text(&record.text);
                }
            } else if let Some(model_id) = id.strip_prefix("model:") {
                if let Err(e) = commands::set_engine(app.clone(), model_id.to_string()) {
                    eprintln!("[tray] failed to switch model: {}", e);
                }
            } else if let Some(mic) = id.strip_prefix("mic:") {
                let state = app.state::<AppState>();
                let mut settings = state.settings.lock().unwrap();
                settings.microphone = if mic.is_empty() { None } else { Some(mic.to_string()) };
                db::Db::new(app).save_settings(&settings);
                drop(settings);
                refresh(app);
            }
        }
    }
}
