use std::sync::atomic::Ordering;

use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, Wry};

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
    let active_engine = state.active_engine_id.lock().unwrap().clone();
    let downloaded = state.model_manager.downloaded_ids();

    let mut items: Vec<Box<dyn IsMenuItem<Wry>>> = Vec::new();

    items.push(Box::new(CheckMenuItem::with_id(
        app,
        "pause",
        "Pause Dictation",
        true,
        paused,
        None::<&str>,
    )?));
    items.push(Box::new(PredefinedMenuItem::separator(app)?));

    let history = db::Db::new(app).get_history();
    if !history.is_empty() {
        items.push(Box::new(MenuItem::with_id(
            app,
            "recent-header",
            "Recent (click to copy)",
            false,
            None::<&str>,
        )?));
        for record in history.iter().take(3) {
            items.push(Box::new(MenuItem::with_id(
                app,
                format!("recent:{}", record.id),
                truncate_label(&record.text),
                true,
                None::<&str>,
            )?));
        }
        items.push(Box::new(PredefinedMenuItem::separator(app)?));
    }

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
        let model_refs: Vec<&dyn IsMenuItem<Wry>> =
            model_items.iter().map(|i| i as &dyn IsMenuItem<Wry>).collect();
        items.push(Box::new(Submenu::with_items(
            app,
            "Model",
            true,
            &model_refs,
        )?));
        items.push(Box::new(PredefinedMenuItem::separator(app)?));
    }

    items.push(Box::new(MenuItem::with_id(
        app,
        "dashboard",
        "Dashboard",
        true,
        None::<&str>,
    )?));
    items.push(Box::new(MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?));

    let item_refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|i| i.as_ref()).collect();
    Menu::with_items(app, &item_refs)
}

/// Rebuild the tray menu to reflect current history/model/pause state.
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

pub fn on_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id.as_ref();
    match id {
        "quit" => std::process::exit(0),
        "dashboard" => {
            let _ = commands::open_dashboard(app.clone());
        }
        "pause" => {
            let state = app.state::<AppState>();
            let now_paused = !state.is_paused.load(Ordering::SeqCst);
            state.is_paused.store(now_paused, Ordering::SeqCst);
            refresh(app);
        }
        _ => {
            if let Some(record_id) = id.strip_prefix("recent:") {
                let history = db::Db::new(app).get_history();
                if let Some(record) = history.iter().find(|r| r.id == record_id) {
                    paste::copy_text(&record.text);
                }
            } else if let Some(model_id) = id.strip_prefix("model:") {
                if let Err(e) = commands::set_engine(app.clone(), model_id.to_string()) {
                    eprintln!("[tray] failed to switch model: {}", e);
                }
            }
        }
    }
}
