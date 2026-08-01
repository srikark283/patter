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
    let ws = { NSWorkspace::sharedWorkspace() };
    let app = { ws.frontmostApplication() }?;
    { app.localizedName() }.map(|s| s.to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn frontmost_app_name() -> Option<String> {
    use std::path::Path;
    use windows::Win32::Foundation::{CloseHandle, MAX_PATH};
    use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }
        let mut process_id = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut process_id));
        if process_id == 0 {
            return None;
        }

        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id).ok()?;
        
        let mut buffer = [0u16; MAX_PATH as usize];
        let mut size = MAX_PATH;
        let success = QueryFullProcessImageNameW(handle, windows::Win32::System::Threading::PROCESS_NAME_FORMAT(0), windows::core::PWSTR(buffer.as_mut_ptr()), &mut size);
        let _ = CloseHandle(handle);

        if success.is_err() || size == 0 {
            return None;
        }

        let path_str = String::from_utf16_lossy(&buffer[..size as usize]);
        let path = Path::new(&path_str);
        
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            let mut name = stem.to_string();
            if let Some(first) = name.chars().next() {
                let capitalized = first.to_uppercase().to_string() + &name[first.len_utf8()..];
                return Some(capitalized);
            }
            return Some(name);
        }
        None
    }
}

/// Clipboard-only fallback for when keystroke synthesis isn't permitted.
pub fn copy_text(text: &str) {
    if let Ok(mut clipboard) = Clipboard::new() {
        let _ = clipboard.set_text(text);
    }
}

/// How long to leave the transcript on the clipboard before putting the user's
/// own contents back. The paste is synthetic, so the target app reads the
/// pasteboard a moment after the keystroke lands; restore too early and it
/// pastes the wrong thing. 150ms clears every app tried without leaving a
/// window wide enough to notice.
const CLIPBOARD_RESTORE_DELAY_MS: u64 = 150;

pub fn paste_text(mode: &str, text: &str) {
    if mode == "type" {
        if let Ok(mut enigo) = Enigo::new(&Settings::default()) {
            let _ = enigo.text(text);
        }
    } else {
        // Whatever the user had copied, so dictating doesn't cost them their
        // clipboard. `get_text` fails when the clipboard holds an image or
        // files; there is nothing to restore in that case, so the transcript
        // stays put rather than the clipboard being wiped.
        // ponytail: text only. Preserving arbitrary pasteboard types needs
        // per-platform APIs arboard doesn't expose.
        let previous = Clipboard::new().ok().and_then(|mut c| c.get_text().ok());

        if let Ok(mut clipboard) = Clipboard::new() {
            let _ = clipboard.set_text(text);

            if let Ok(mut enigo) = Enigo::new(&Settings::default()) {
                #[cfg(target_os = "macos")]
                let modifier = Key::Meta;
                #[cfg(not(target_os = "macos"))]
                let modifier = Key::Control;

                let _ = enigo.key(modifier, Direction::Press);
                let _ = enigo.key(Key::Unicode('v'), Direction::Click);
                let _ = enigo.key(modifier, Direction::Release);
            }
        }

        if let Some(previous) = previous {
            // This runs on the main thread (see recording.rs), so the wait goes
            // to a worker — sleeping here would freeze the UI mid-dictation.
            let pasted = text.to_string();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(
                    CLIPBOARD_RESTORE_DELAY_MS,
                ));
                if let Ok(mut clipboard) = Clipboard::new() {
                    // Only reclaim the clipboard if it is still ours. A user who
                    // copied something during the delay keeps what they copied.
                    if clipboard.get_text().ok().as_deref() == Some(pasted.as_str()) {
                        let _ = clipboard.set_text(previous);
                    }
                }
            });
        }
    }
}

pub fn undo() {
    if let Ok(mut enigo) = Enigo::new(&Settings::default()) {
        #[cfg(target_os = "macos")]
        let modifier = Key::Meta;
        #[cfg(not(target_os = "macos"))]
        let modifier = Key::Control;

        let _ = enigo.key(modifier, Direction::Press);
        let _ = enigo.key(Key::Unicode('z'), Direction::Click);
        let _ = enigo.key(modifier, Direction::Release);
    }
}
