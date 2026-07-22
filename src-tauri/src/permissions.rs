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
pub fn microphone_authorized() -> bool {
    use objc2::msg_send;
    use objc2::runtime::AnyClass;
    use objc2_foundation::NSString;

    unsafe {
        let Some(cls) = AnyClass::get(c"AVCaptureDevice") else {
            return true;
        };
        let media_type = NSString::from_str("avft");
        let status: i64 = msg_send![cls, authorizationStatusForMediaType: &*media_type];
        // AVAuthorizationStatus: notDetermined=0, restricted=1, denied=2, authorized=3.
        status == 3
    }
}

#[cfg(target_os = "macos")]
pub fn request_microphone_permission() -> bool {
    use objc2::msg_send;
    use objc2::runtime::AnyClass;
    use objc2_foundation::NSString;

    unsafe {
        let Some(cls) = AnyClass::get(c"AVCaptureDevice") else {
            return true;
        };
        let media_type = NSString::from_str("avft");
        let status: i64 = msg_send![cls, authorizationStatusForMediaType: &*media_type];
        if status == 3 {
            return true;
        }

        // Force host audio input query to nudge macOS TCC prompt if notDetermined
        use cpal::traits::HostTrait;
        if let Ok(devices) = cpal::default_host().input_devices() {
            let _ = devices.count();
        }

        let status_after: i64 = msg_send![cls, authorizationStatusForMediaType: &*media_type];
        status_after == 3
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
    use objc2_foundation::{NSDictionary, NSNumber, NSString};
    unsafe {
        #[link(name = "ApplicationServices", kind = "framework")]
        extern "C" {
            fn AXIsProcessTrustedWithOptions(options: *const objc2::runtime::AnyObject) -> u8;
        }
        let key = NSString::from_str("AXTrustedCheckOptionPrompt");
        let val = NSNumber::numberWithBool(true);
        let dict = NSDictionary::from_slices(&[&*key], &[&*val]);
        let trusted = AXIsProcessTrustedWithOptions(&*dict as *const _ as *const _) != 0;
        if !trusted {
            let _ = open_accessibility_settings();
        }
        trusted
    }
}

#[cfg(not(target_os = "macos"))]
pub fn request_accessibility_permission() -> bool {
    true
}

#[cfg(target_os = "macos")]
pub fn request_input_monitoring_permission() -> bool {
    unsafe {
        #[link(name = "ApplicationServices", kind = "framework")]
        extern "C" {
            fn CGRequestListenEventAccess() -> u8;
        }
        let trusted = CGRequestListenEventAccess() != 0;
        if !trusted {
            let _ = open_input_monitoring_settings();
        }
        trusted
    }
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
