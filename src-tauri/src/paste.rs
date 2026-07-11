use arboard::Clipboard;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};

/// Both output modes synthesize keystrokes via enigo, which needs the
/// Accessibility permission on macOS.
#[cfg(target_os = "macos")]
pub fn accessibility_trusted() -> bool {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> u8;
    }
    unsafe { AXIsProcessTrusted() != 0 }
}

#[cfg(not(target_os = "macos"))]
pub fn accessibility_trusted() -> bool {
    true
}

/// Name of the app the user is currently in (the paste target).
#[cfg(target_os = "macos")]
pub fn frontmost_app_name() -> Option<String> {
    use objc2_app_kit::NSWorkspace;
    let ws = unsafe { NSWorkspace::sharedWorkspace() };
    let app = unsafe { ws.frontmostApplication() }?;
    unsafe { app.localizedName() }.map(|s| s.to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn frontmost_app_name() -> Option<String> {
    None
}

/// Clipboard-only fallback for when keystroke synthesis isn't permitted.
pub fn copy_text(text: &str) {
    if let Ok(mut clipboard) = Clipboard::new() {
        let _ = clipboard.set_text(text);
    }
}

pub fn paste_text(mode: &str, text: &str) {
    if mode == "type" {
        if let Ok(mut enigo) = Enigo::new(&Settings::default()) {
            let _ = enigo.text(text);
        }
    } else {
        if let Ok(mut clipboard) = Clipboard::new() {
            let _ = clipboard.set_text(text);

            if let Ok(mut enigo) = Enigo::new(&Settings::default()) {
                let _ = enigo.key(Key::Meta, Direction::Press);
                let _ = enigo.key(Key::Unicode('v'), Direction::Click);
                let _ = enigo.key(Key::Meta, Direction::Release);
            }
        }
    }
}
