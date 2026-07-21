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

pub fn paste_text(mode: &str, text: &str) {
    if mode == "type" {
        if let Ok(mut enigo) = Enigo::new(&Settings::default()) {
            let _ = enigo.text(text);
        }
    } else {
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
