//! Exchanges asked from the phone's home screen (ccez-launcher's Ask,
//! answered by `AskService.kt`, owner 2026-11-18) wait in
//! `home-asks.json` in the app data folder until the window takes them
//! into its chats (`importHomeAsks` in chat.ts). Taking renames the file
//! first, so a thread the service writes meanwhile lands in a new file
//! and waits for the next take instead of being lost.
use tauri::Manager;

const FILE: &str = "home-asks.json";

/// The waiting exchanges as the service wrote them, once; None when
/// nothing waits (always, off Android).
#[tauri::command]
pub fn home_asks_take<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Option<String> {
    let dir = app.path().app_data_dir().ok()?;
    take_from(&dir)
}

fn take_from(dir: &std::path::Path) -> Option<String> {
    let path = dir.join(FILE);
    let taking = dir.join("home-asks.taking.json");
    std::fs::rename(&path, &taking).ok()?;
    let text = std::fs::read_to_string(&taking).ok();
    let _ = std::fs::remove_file(&taking);
    text.filter(|t| !t.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::take_from;

    #[test]
    fn takes_once_and_leaves_nothing() {
        let dir = std::env::temp_dir().join(format!("home-asks-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(take_from(&dir), None, "nothing waits");
        std::fs::write(dir.join("home-asks.json"), r#"{"chats":[]}"#).unwrap();
        assert_eq!(take_from(&dir).as_deref(), Some(r#"{"chats":[]}"#));
        assert_eq!(take_from(&dir), None, "taken once");
        assert!(
            std::fs::read_dir(&dir).unwrap().next().is_none(),
            "no file left behind"
        );
        std::fs::remove_dir_all(&dir).ok();
    }
}
