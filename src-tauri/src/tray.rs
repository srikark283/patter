use std::sync::atomic::Ordering;

use tauri::menu::{
    CheckMenuItem, IconMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem,
    Submenu,
};
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri::path::BaseDirectory;
use tauri::image::Image;

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

    // Load custom Phosphor icons
    let icon_users = Image::from_path(app.path().resolve("icons/menu/users.png", BaseDirectory::Resource)?)?;
    let icon_copy = Image::from_path(app.path().resolve("icons/menu/copy.png", BaseDirectory::Resource)?)?;
    let icon_pause = Image::from_path(app.path().resolve("icons/menu/pause.png", BaseDirectory::Resource)?)?;
    let icon_play = Image::from_path(app.path().resolve("icons/menu/play.png", BaseDirectory::Resource)?)?;
    let icon_gear = Image::from_path(app.path().resolve("icons/menu/gear.png", BaseDirectory::Resource)?)?;
    let icon_dict = Image::from_path(app.path().resolve("icons/menu/dictionary.png", BaseDirectory::Resource)?)?;
    let icon_sparkle = Image::from_path(app.path().resolve("icons/menu/sparkle.png", BaseDirectory::Resource)?)?;
    let icon_folder = Image::from_path(app.path().resolve("icons/menu/folder.png", BaseDirectory::Resource)?)?;
    let icon_history = Image::from_path(app.path().resolve("icons/menu/history.png", BaseDirectory::Resource)?)?;
    let icon_home = Image::from_path(app.path().resolve("icons/menu/home.png", BaseDirectory::Resource)?)?;

    // ── Group 1: Core Actions ───────────────────────────────────────
    items.push(Box::new(IconMenuItem::with_id(
        app,
        "meeting",
        if meeting_active { "Stop Meeting Notes" } else { "Start Meeting Notes" },
        true,
        Some(icon_users),
        None::<&str>,
    )?));

    items.push(Box::new(IconMenuItem::with_id(
        app,
        "copy-last",
        "Copy Last Transcription",
        !history.is_empty(),
        Some(icon_copy),
        None::<&str>,
    )?));

    items.push(Box::new(IconMenuItem::with_id(
        app,
        "pause",
        if paused { "Resume Dictation" } else { "Pause Dictation" },
        true,
        Some(if paused { icon_play } else { icon_pause }),
        None::<&str>,
    )?));

    items.push(Box::new(PredefinedMenuItem::separator(app)?));

    // ── Group 2: Configuration & Models ─────────────────────────────
    items.push(Box::new(IconMenuItem::with_id(
        app,
        "nav:dashboard",
        "Home",
        true,
        Some(icon_home),
        None::<&str>,
    )?));

    items.push(Box::new(IconMenuItem::with_id(
        app,
        "nav:preferences",
        "General Settings",
        true,
        Some(icon_gear),
        Some("CmdOrCtrl+,"),
    )?));

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
        items.push(Box::new(Submenu::with_items(app, "Speech Models", true, &refs)?));
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

    items.push(Box::new(IconMenuItem::with_id(
        app,
        "nav:dictionary",
        "Dictionary",
        true,
        Some(icon_dict),
        None::<&str>,
    )?));

    items.push(Box::new(PredefinedMenuItem::separator(app)?));

    // ── Group 3: AI & Workflows ─────────────────────────────────────
    items.push(Box::new(IconMenuItem::with_id(
        app,
        "nav:ai",
        "Intelligence Setup",
        true,
        Some(icon_sparkle),
        None::<&str>,
    )?));

    items.push(Box::new(IconMenuItem::with_id(
        app,
        "nav:meetings",
        "Meetings & Notes",
        true,
        Some(icon_folder),
        None::<&str>,
    )?));

    items.push(Box::new(PredefinedMenuItem::separator(app)?));

    // ── Group 4: History & Logs ─────────────────────────────────────

    items.push(Box::new(IconMenuItem::with_id(
        app,
        "nav:history",
        "History",
        true,
        Some(icon_history),
        None::<&str>,
    )?));

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

    // ── Group 5: Quit ───────────────────────────────────────────────
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
                crate::meeting::stop_meeting(app, None)
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
