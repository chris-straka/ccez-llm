//! Settings on disk for the command line (desktop).
//!
//! The app's settings live in the webview's localStorage, which nothing
//! outside the app can read. Every save also lands here as
//! `settings.json` in the app data folder (keys blanked by the
//! frontend), and an edit made from outside (`scripts/settings.ts`)
//! comes back to the window as a `settings-external` event, so a change
//! from a terminal shows in the running app within a second. With the
//! app closed, the next launch picks the edit up from the file.

#![cfg_attr(not(desktop), allow(dead_code))]

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Event the window hears when the file changed from outside the app.
pub const SETTINGS_EXTERNAL_EVENT: &str = "settings-external";
const FILE_NAME: &str = "settings.json";

/// What the file held when the app last wrote or read it: a change the
/// app made itself never comes back as an outside edit.
static KNOWN: Mutex<Option<Value>> = Mutex::new(None);
static WATCHING: Mutex<bool> = Mutex::new(false);

fn settings_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(FILE_NAME))
        .map_err(|e| e.to_string())
}

/// The file's JSON when it parses; a half-written file reads as None.
fn read_value(path: &Path) -> Option<(String, Value)> {
    let raw = std::fs::read_to_string(path).ok()?;
    let value = serde_json::from_str::<Value>(&raw).ok()?;
    value.is_object().then_some((raw, value))
}

/// An outside edit: the file parses and differs from what the app knows.
pub fn outside_edit(known: Option<&Value>, now: &Value) -> bool {
    known != Some(now)
}

/// Write the settings once the window has read the file (pretty,
/// through a temporary file so a reader never sees half of it).
#[cfg(desktop)]
#[tauri::command]
pub fn settings_file_write<R: Runtime>(app: AppHandle<R>, json: String) -> Result<(), String> {
    // Saves at launch come before the window reads the file: writing
    // then would wipe an edit made while the app was closed.
    if !*WATCHING.lock().map_err(|e| e.to_string())? {
        return Ok(());
    }
    let value: Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    let path = settings_path(&app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let pretty = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    // Known before the file changes, so the watcher never reads this
    // write as an outside edit.
    *KNOWN.lock().map_err(|e| e.to_string())? = Some(value);
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, pretty + "\n").map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// Start watching the file (once) and return what it holds now, or
/// None when there is no file yet. The window applies the returned
/// settings when they differ from its own: an edit made while the app
/// was closed.
#[cfg(desktop)]
#[tauri::command]
pub fn settings_file_watch<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    let path = settings_path(&app)?;
    let now = read_value(&path);
    *KNOWN.lock().map_err(|e| e.to_string())? = now.as_ref().map(|(_, v)| v.clone());
    let mut watching = WATCHING.lock().map_err(|e| e.to_string())?;
    if !*watching {
        *watching = true;
        std::thread::spawn(move || watch(app, path));
    }
    Ok(now.map(|(raw, _)| raw))
}

/// Poll the file once a second: cheap for a few kilobytes, and no
/// watcher crate for one file.
#[cfg(desktop)]
fn watch<R: Runtime>(app: AppHandle<R>, path: PathBuf) {
    let mut seen: Option<SystemTime> = None;
    loop {
        std::thread::sleep(Duration::from_secs(1));
        let Ok(modified) = std::fs::metadata(&path).and_then(|m| m.modified()) else {
            continue;
        };
        if seen == Some(modified) {
            continue;
        }
        // Half written: try again next tick, mtime unrecorded.
        let Some((raw, value)) = read_value(&path) else {
            continue;
        };
        seen = Some(modified);
        let Ok(mut known) = KNOWN.lock() else {
            continue;
        };
        if !outside_edit(known.as_ref(), &value) {
            continue;
        }
        *known = Some(value);
        drop(known);
        let _ = app.emit(SETTINGS_EXTERNAL_EVENT, raw);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_a_different_file_is_an_outside_edit() {
        let a = json!({ "textScale": 1.5, "voice": false });
        // Key order and spacing don't matter.
        let same: Value = serde_json::from_str(r#"{"voice":false, "textScale":1.5}"#).unwrap();
        assert!(!outside_edit(Some(&a), &same));
        assert!(outside_edit(
            Some(&a),
            &json!({ "textScale": 2, "voice": false })
        ));
        assert!(outside_edit(None, &a));
    }

    #[test]
    fn a_half_written_file_reads_as_nothing() {
        let dir = std::env::temp_dir().join(format!("ccez-settings-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(FILE_NAME);
        std::fs::write(&path, r#"{"textScale": 1."#).unwrap();
        assert!(read_value(&path).is_none());
        std::fs::write(&path, "[]").unwrap();
        assert!(read_value(&path).is_none());
        std::fs::write(&path, r#"{"textScale": 1.5}"#).unwrap();
        assert_eq!(read_value(&path).unwrap().1, json!({ "textScale": 1.5 }));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
