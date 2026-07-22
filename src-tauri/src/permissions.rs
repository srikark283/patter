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
fn get_av_media_type_audio() -> Option<*const objc2::runtime::AnyObject> {
    extern "C" {
        fn dlopen(path: *const std::ffi::c_char, mode: std::ffi::c_int) -> *mut std::ffi::c_void;
        fn dlsym(handle: *mut std::ffi::c_void, symbol: *const std::ffi::c_char) -> *mut std::ffi::c_void;
        fn dlclose(handle: *mut std::ffi::c_void) -> std::ffi::c_int;
    }
    unsafe {
        let handle = dlopen(
            c"/System/Library/Frameworks/AVFoundation.framework/AVFoundation".as_ptr(),
            1, // RTLD_LAZY
        );
        if handle.is_null() {
            return None;
        }
        let sym = dlsym(handle, c"AVMediaTypeAudio".as_ptr());
        if sym.is_null() {
            dlclose(handle);
            return None;
        }
        let media_type_ptr = *(sym as *const *const objc2::runtime::AnyObject);
        dlclose(handle);
        if media_type_ptr.is_null() {
            None
        } else {
            Some(media_type_ptr)
        }
    }
}

#[cfg(target_os = "macos")]
pub fn microphone_authorized() -> bool {
    use objc2::msg_send;
    use objc2::runtime::AnyClass;

    unsafe {
        let Some(media_type_ptr) = get_av_media_type_audio() else {
            return true;
        };
        let Some(cls) = AnyClass::get(c"AVCaptureDevice") else {
            return true;
        };
        let status: i64 = msg_send![cls, authorizationStatusForMediaType: media_type_ptr];
        // AVAuthorizationStatus: notDetermined=0, restricted=1, denied=2, authorized=3.
        status == 3
    }
}

#[cfg(target_os = "macos")]
pub fn request_microphone_permission() -> bool {
    use objc2::msg_send;
    use objc2::runtime::AnyClass;

    unsafe {
        let Some(media_type_ptr) = get_av_media_type_audio() else {
            return true;
        };
        let Some(cls) = AnyClass::get(c"AVCaptureDevice") else {
            return true;
        };
        let status: i64 = msg_send![cls, authorizationStatusForMediaType: media_type_ptr];
        if status == 3 {
            return true;
        }

        // Force host audio input query to nudge macOS TCC prompt if notDetermined
        use cpal::traits::HostTrait;
        if let Ok(devices) = cpal::default_host().input_devices() {
            let _ = devices.count();
        }

        let status_after: i64 = msg_send![cls, authorizationStatusForMediaType: media_type_ptr];
        if status_after != 3 {
            let _ = open_microphone_settings();
        }
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
