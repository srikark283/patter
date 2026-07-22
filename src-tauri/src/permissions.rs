use serde::Serialize;

/// Accessibility, Input Monitoring, and Microphone are TCC-gated on macOS —
/// Patter needs all three (keystroke injection, global hotkey capture, and
/// meeting/dictation recording). Windows has no equivalent granular
/// permission model for the first two, so those always report granted there;
/// microphone access is still meaningful and checked for real.
#[derive(Serialize, Clone, Copy)]
pub struct PermissionStatus {
    pub accessibility: bool,
    pub input_monitoring: bool,
    pub microphone: bool,
}

pub fn get_status() -> PermissionStatus {
    PermissionStatus {
        accessibility: crate::paste::accessibility_trusted(),
        input_monitoring: input_monitoring_trusted(),
        microphone: microphone_authorized(),
    }
}

#[cfg(target_os = "macos")]
pub fn input_monitoring_trusted() -> bool {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn CGPreflightListenEventAccess() -> u8;
    }
    unsafe { CGPreflightListenEventAccess() != 0 }
}

#[cfg(not(target_os = "macos"))]
pub fn input_monitoring_trusted() -> bool {
    true
}

#[cfg(target_os = "macos")]
#[link(name = "AVFoundation", kind = "framework")]
unsafe extern "C" {
    static AVMediaTypeAudio: *const objc2::runtime::AnyObject;
}

#[cfg(target_os = "macos")]
pub fn microphone_authorized() -> bool {
    use objc2::msg_send;
    use objc2::runtime::AnyClass;

    unsafe {
        let Some(cls) = AnyClass::get(c"AVCaptureDevice") else {
            return true;
        };
        let status: i64 = msg_send![cls, authorizationStatusForMediaType: AVMediaTypeAudio];
        // AVAuthorizationStatus: notDetermined=0, restricted=1, denied=2, authorized=3.
        status == 3
    }
}

#[cfg(target_os = "macos")]
pub fn request_microphone_permission() -> bool {
    use block2::RcBlock;
    use objc2::msg_send;
    use objc2::runtime::AnyClass;
    use std::sync::mpsc;
    use std::time::Duration;

    unsafe {
        let Some(cls) = AnyClass::get(c"AVCaptureDevice") else {
            return true;
        };
        let status: i64 = msg_send![cls, authorizationStatusForMediaType: AVMediaTypeAudio];
        if status == 3 {
            return true;
        }

        if status == 0 {
            // Not determined: prompt the system permission dialog for Microphone access
            let (tx, rx) = mpsc::channel();
            let block = RcBlock::new(move |granted: objc2::runtime::Bool| {
                let _ = tx.send(granted.as_bool());
            });
            let _: () = msg_send![cls, requestAccessForMediaType: AVMediaTypeAudio, completionHandler: &*block];

            let granted = rx.recv_timeout(Duration::from_secs(30)).unwrap_or(false);
            if !granted {
                let _ = open_microphone_settings();
            }
            return granted;
        }

        // Status is denied (2) or restricted (1): open privacy settings directly
        let _ = open_microphone_settings();
        false
    }
}

#[cfg(not(target_os = "macos"))]
pub fn microphone_authorized() -> bool {
    true
}

#[cfg(not(target_os = "macos"))]
pub fn request_microphone_permission() -> bool {
    true
}

#[cfg(target_os = "macos")]
pub fn request_accessibility_permission() -> bool {
    let trusted = crate::paste::accessibility_trusted();
    if !trusted {
        let _ = open_accessibility_settings();
    }
    trusted
}

#[cfg(not(target_os = "macos"))]
pub fn request_accessibility_permission() -> bool {
    true
}

#[cfg(target_os = "macos")]
pub fn request_input_monitoring_permission() -> bool {
    let trusted = input_monitoring_trusted();
    if !trusted {
        let _ = open_input_monitoring_settings();
    }
    trusted
}

#[cfg(not(target_os = "macos"))]
pub fn request_input_monitoring_permission() -> bool {
    true
}

#[cfg(target_os = "macos")]
fn open_pane(url: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn open_accessibility_settings() -> Result<(), String> {
    open_pane("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
}

#[cfg(not(target_os = "macos"))]
pub fn open_accessibility_settings() -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn open_input_monitoring_settings() -> Result<(), String> {
    open_pane("x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")
}

#[cfg(target_os = "macos")]
pub fn open_microphone_settings() -> Result<(), String> {
    open_pane("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
}

#[cfg(target_os = "macos")]
pub fn open_notification_settings() -> Result<(), String> {
    open_pane("x-apple.systempreferences:com.apple.preference.notifications")
}

#[cfg(not(target_os = "macos"))]
pub fn open_input_monitoring_settings() -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn open_microphone_settings() -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/C", "start", "ms-settings:privacy-microphone"])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn open_notification_settings() -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/C", "start", "ms-settings:notifications"])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
