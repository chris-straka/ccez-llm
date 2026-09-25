//! Capture-any-window screenshots (macOS): window listing plus
//! single-window capture for the OCR loop.
//!
//! The global chord (see `desktop.rs`) fires while another app is
//! focused, so the backend must find that app's window itself: no
//! `getDisplayMedia` picker can run outside the webview. Window
//! discovery is `CGWindowListCopyWindowInfo` (Quartz C API — linked,
//! never a sidecar) with the dictionaries read through the generated
//! `objc2-foundation` bindings, the same no-Objective-C rule as
//! `tts.rs` / `ocr.rs`. Capture itself shells to the `screencapture`
//! CLI (`-l<id>` one window, `-m` fullscreen), verified locally via
//! `screencapture -h`: zero new crates either way.
//!
//! Design: `list_windows` returns on-screen normal-layer windows
//! front-to-back, own process excluded (the composer-button path fires
//! while our window is frontmost — without the exclusion it would
//! capture itself). `capture_window` takes an explicit id (the source
//! menu's pick), a saved id (the chord reuses the last pick), or
//! nothing (frontmost non-app window); the pure [`choose_source`]
//! owns that fallback and is unit-tested. Pixels return as base64 PNG,
//! which feeds `ocr_recognize` (raw base64 in) with no new types.
//!
//! Screen Recording permission: the OS prompts once on first capture,
//! never at launch — nothing here runs until the chord or the button
//! fires. A denied grant surfaces as a failed `screencapture` status,
//! reported verbatim so the UI can name the fix.
//!
//! Every other platform reports "unsupported" (the frontend gates on
//! `capture_supported`, same contract as `ocr_supported`).

/// One on-screen window: the source menu's row model. `id` is the
/// `CGWindowID` for `capture_window`; the list arrives front-to-back.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct WindowInfo {
    pub id: u32,
    pub owner: String,
    pub title: String,
}

/// Interactive capture mode: the OS picker instead of our window
/// list. `Window` is the native hover-tint window choice (camera
/// cursor, click captures, Esc cancels); `Area` is the crosshair
/// area drag. Deserializes from the frontend's lowercase kind.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InteractiveKind {
    Window,
    Area,
}

/// `screencapture -i` mode flag per kind. Pure (unit-tested beside
/// [`choose_source`]).
pub fn interactive_flag(kind: InteractiveKind) -> &'static str {
    match kind {
        InteractiveKind::Window => "-w",
        InteractiveKind::Area => "-s",
    }
}

/// Pick the window to capture: an explicit or saved id wins when it is
/// still on screen, otherwise the frontmost entry (the list order).
/// Nothing on screen resolves to nothing — the caller reports that,
/// never a throw. Pure.
pub fn choose_source(saved: Option<u32>, windows: &[WindowInfo]) -> Option<u32> {
    if let Some(id) = saved {
        if windows.iter().any(|window| window.id == id) {
            return Some(id);
        }
    }
    windows.first().map(|window| window.id)
}

#[tauri::command]
pub fn capture_supported() -> bool {
    #[cfg(target_os = "macos")]
    {
        true
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

#[tauri::command]
pub fn list_windows() -> Result<Vec<WindowInfo>, String> {
    #[cfg(target_os = "macos")]
    {
        imp::list_windows()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("window capture is not supported on this platform".to_string())
    }
}

/// Capture a window (or the full screen) as base64 PNG. `window_id` is
/// the menu pick; when it is missing the saved pick in
/// `saved_window_id` wins if still on screen, else the frontmost
/// non-app window. `fullscreen` ignores both ids (`screencapture -m`).
/// Interactive capture (`screencapture -i`): the OS runs its native
/// picker — hover-tint window choice or crosshair area drag — so the
/// composer offers three static actions and no window list. Our
/// window hides first while it is focused (the button path fires
/// with us frontmost; without the hide we would capture ourselves),
/// restoring right after; an unfocused start (the chord path never
/// lands here) leaves focus alone. Esc/right-click writes no file:
/// that resolves to `Ok(None)` — a silent cancel, never an error
/// toast. A failed launch or a denial (stderr names Screen
/// Recording) reports instead.
#[tauri::command]
pub fn capture_interactive(
    app: tauri::AppHandle,
    kind: InteractiveKind,
) -> Result<Option<String>, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (&app, kind);
        Err("window capture is not supported on this platform".to_string())
    }
    #[cfg(target_os = "macos")]
    {
        imp::capture_interactive(app, kind)
    }
}

/// `screencapture -R` flag for a rect in device pixels (global
/// display space). Pure (unit-tested).
pub fn rect_flag(x: u32, y: u32, width: u32, height: u32) -> String {
    format!("-R{x},{y},{width},{height}")
}

/// Capture a screen rect (device pixels, global display space) as
/// base64 PNG. The area picker saves its square in these units and
/// the chord reuses it; empty rects report instead of screenshotting.
#[tauri::command]
pub fn capture_rect(x: u32, y: u32, width: u32, height: u32) -> Result<String, String> {
    if width == 0 || height == 0 {
        return Err("the capture area is empty".to_string());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (x, y, width, height);
        Err("window capture is not supported on this platform".to_string())
    }
    #[cfg(target_os = "macos")]
    {
        imp::capture_rect(x, y, width, height)
    }
}

#[tauri::command]
pub fn capture_window(
    window_id: Option<u32>,
    saved_window_id: Option<u32>,
    fullscreen: bool,
) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        imp::capture_window(window_id, saved_window_id, fullscreen)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window_id, saved_window_id, fullscreen);
        Err("window capture is not supported on this platform".to_string())
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use super::{WindowInfo, choose_source};
    use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSArray, NSDictionary, NSString};
    use std::ffi::c_void;

    /// `kCGWindowListOptionOnScreenOnly`: relative-to ordering is
    /// front-to-back, which is what the frontmost fallback needs.
    const WINDOW_LIST_ON_SCREEN_ONLY: u32 = 1;
    const NULL_WINDOW_ID: u32 = 0;
    /// `kCFNumberSInt64Type`: every numeric window field fits.
    const CF_NUMBER_SINT64: i32 = 4;
    /// Normal windows live on layer 0; menu bar, Dock, and overlays
    /// do not.
    const NORMAL_WINDOW_LAYER: i64 = 0;
    /// Never return a phone book: the menu needs rows, not exhaust.
    const MAX_WINDOWS: usize = 100;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGWindowListCopyWindowInfo(option: u32, relative_to_window: u32) -> *const c_void;
        fn CFRelease(cf: *const c_void);
        fn CFNumberGetValue(number: *const c_void, the_type: i32, value_ptr: *mut c_void) -> u8;
    }

    /// Read a string field off a window dictionary: missing keys and
    /// non-strings both land empty (untitled windows are still rows).
    fn dict_string(dict: &NSDictionary<NSString, AnyObject>, key: &str) -> String {
        let ns_key = NSString::from_str(key);
        let value: Option<objc2::rc::Retained<AnyObject>> =
            unsafe { objc2::msg_send![dict, objectForKey: &*ns_key] };
        value
            .as_ref()
            .and_then(|any| any.downcast_ref::<NSString>())
            .map(|string| string.to_string())
            .unwrap_or_default()
    }

    /// Read a numeric field: missing keys, nulls, and non-numbers
    /// miss (the caller skips the entry, never a half row).
    fn dict_number(dict: &NSDictionary<NSString, AnyObject>, key: &str) -> Option<i64> {
        let ns_key = NSString::from_str(key);
        let value: Option<objc2::rc::Retained<AnyObject>> =
            unsafe { objc2::msg_send![dict, objectForKey: &*ns_key] };
        let number = value?;
        let raw: *const c_void = objc2::rc::Retained::as_ptr(&number) as *const c_void;
        if raw.is_null() {
            return None;
        }
        let mut out: i64 = 0;
        let ok = unsafe {
            CFNumberGetValue(raw, CF_NUMBER_SINT64, (&mut out as *mut i64) as *mut c_void)
        };
        if ok == 0 {
            return None;
        }
        Some(out)
    }

    pub fn list_windows() -> Result<Vec<WindowInfo>, String> {
        let raw = unsafe { CGWindowListCopyWindowInfo(WINDOW_LIST_ON_SCREEN_ONLY, NULL_WINDOW_ID) };
        if raw.is_null() {
            return Err("the window list is unavailable".to_string());
        }
        let windows = {
            let array =
                unsafe { &*(raw as *const NSArray<NSDictionary<NSString, AnyObject>>) };
            let own_pid = std::process::id() as i64;
            let mut out = Vec::new();
            for dict in array.iter().take(MAX_WINDOWS) {
                let layer = match dict_number(&dict, "kCGWindowLayer") {
                    Some(layer) => layer,
                    None => continue,
                };
                if layer != NORMAL_WINDOW_LAYER {
                    continue;
                }
                if dict_number(&dict, "kCGWindowOwnerPID") == Some(own_pid) {
                    continue;
                }
                let id = match dict_number(&dict, "kCGWindowNumber") {
                    Some(id) => u32::try_from(id).ok(),
                    None => None,
                };
                let Some(id) = id else { continue };
                let owner = dict_string(&dict, "kCGWindowOwnerName");
                if owner.is_empty() {
                    continue;
                }
                out.push(WindowInfo {
                    id,
                    owner,
                    title: dict_string(&dict, "kCGWindowName"),
                });
            }
            out
        };
        unsafe { CFRelease(raw) };
        Ok(windows)
    }

    /// Read a finished capture off disk as base64 PNG, removing the
    /// temp file either way.
    fn read_capture(path: &std::path::Path) -> Result<String, String> {
        let bytes = std::fs::read(path)
            .map_err(|_| "the captured image could not be read".to_string())?;
        let _ = std::fs::remove_file(path);
        Ok(BASE64.encode(&bytes))
    }

    pub fn capture_rect(x: u32, y: u32, width: u32, height: u32) -> Result<String, String> {
        let path = temp_png();
        let path_arg = path.to_string_lossy().into_owned();
        let status = std::process::Command::new("/usr/sbin/screencapture")
            .args(["-x", "-o", &super::rect_flag(x, y, width, height), &path_arg])
            .status()
            .map_err(|_| "screen capture could not start".to_string())?;
        if !status.success() {
            let _ = std::fs::remove_file(&path);
            return Err(
                "screen capture failed: allow Screen Recording for Ccez LLM, then retry"
                    .to_string(),
            );
        }
        read_capture(&path)
    }

    /// Unique temp PNG per capture (chord taps can double-fire):
    /// pid plus a nanos stamp, removed right after the read.
    fn temp_png() -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|span| span.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("ccez-capture-{}-{nanos}.png", std::process::id()))
    }

    pub fn capture_interactive(
        app: tauri::AppHandle,
        kind: super::InteractiveKind,
    ) -> Result<Option<String>, String> {
        use tauri::Manager as _;
        let main = app.get_webview_window("main");
        let hide = main
            .as_ref()
            .map(|window| window.is_focused().unwrap_or(false))
            .unwrap_or(false);
        if hide {
            if let Some(window) = main.as_ref() {
                let _ = window.hide();
            }
        }
        let path = temp_png();
        let path_arg = path.to_string_lossy().into_owned();
        let output = std::process::Command::new("/usr/sbin/screencapture")
            .args(["-x", "-o", "-i", super::interactive_flag(kind), &path_arg])
            .output()
            .map_err(|_| "screen capture could not start".to_string());
        if hide {
            if let Some(window) = main.as_ref() {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        let output = output?;
        if path.exists() {
            let bytes = std::fs::read(&path)
                .map_err(|_| "the captured image could not be read".to_string())?;
            let _ = std::fs::remove_file(&path);
            return Ok(Some(BASE64.encode(&bytes)));
        }
        let _ = std::fs::remove_file(&path);
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Ok(None);
        }
        let capped: String = stderr.chars().take(300).collect();
        Err(capped)
    }

    pub fn capture_window(
        window_id: Option<u32>,
        saved_window_id: Option<u32>,
        fullscreen: bool,
    ) -> Result<String, String> {
        let path = temp_png();
        let path_arg = path.to_string_lossy().into_owned();
        let mut args: Vec<String> = vec!["-x".to_string(), "-o".to_string(), path_arg];
        if fullscreen {
            args.insert(0, "-m".to_string());
        } else {
            let windows =
                list_windows().map_err(|_| "the window list is unavailable".to_string())?;
            let wanted = window_id.or(saved_window_id);
            match choose_source(wanted, &windows) {
                Some(id) => args.insert(0, format!("-l{id}")),
                None => return Err("no capturable window is on screen".to_string()),
            }
        }
        let status = std::process::Command::new("/usr/sbin/screencapture")
            .args(&args)
            .status()
            .map_err(|_| "screen capture could not start".to_string())?;
        if !status.success() {
            let _ = std::fs::remove_file(&path);
            return Err(
                "screen capture failed: allow Screen Recording for Ccez LLM, then retry"
                    .to_string(),
            );
        }
        read_capture(&path)
    }
}

#[cfg(test)]
mod tests {
    use super::{InteractiveKind, WindowInfo, choose_source, interactive_flag, rect_flag};

    fn window(id: u32, owner: &str) -> WindowInfo {
        WindowInfo {
            id,
            owner: owner.into(),
            title: format!("{owner} window"),
        }
    }

    #[test]
    fn saved_pick_wins_while_on_screen() {
        let windows = vec![window(11, "BlueStacks"), window(22, "Safari")];
        assert_eq!(choose_source(Some(22), &windows), Some(22));
    }

    #[test]
    fn stale_saved_pick_falls_back_to_frontmost() {
        let windows = vec![window(11, "BlueStacks"), window(22, "Safari")];
        assert_eq!(choose_source(Some(99), &windows), Some(11));
    }

    #[test]
    fn no_saved_pick_takes_frontmost() {
        let windows = vec![window(11, "BlueStacks"), window(22, "Safari")];
        assert_eq!(choose_source(None, &windows), Some(11));
    }

    #[test]
    fn empty_list_resolves_to_nothing() {
        assert_eq!(choose_source(Some(11), &[]), None);
        assert_eq!(choose_source(None, &[]), None);
    }

    #[test]
    fn interactive_modes_map_to_picker_flags() {
        assert_eq!(interactive_flag(InteractiveKind::Window), "-w");
        assert_eq!(interactive_flag(InteractiveKind::Area), "-s");
    }

    #[test]
    fn rect_flag_formats_global_device_pixels() {
        assert_eq!(rect_flag(10, 20, 300, 150), "-R10,20,300,150");
    }
}
