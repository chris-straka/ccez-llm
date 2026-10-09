//! Listening drills: the `ccez-listen` crate behind commands, on every
//! platform (it talks to YouTube over plain HTTPS; clips cache under
//! the app's cache dir).

use std::sync::OnceLock;

use ccez_listen::{ChannelPage, Entry, Fetched, Listen, VideoInfo};
use tauri::{AppHandle, Manager};

fn listen(app: &AppHandle) -> Result<&'static Listen, String> {
    static LISTEN: OnceLock<Listen> = OnceLock::new();
    if let Some(l) = LISTEN.get() {
        return Ok(l);
    }
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("listen");
    Ok(LISTEN.get_or_init(|| Listen::new(dir)))
}

#[tauri::command]
pub async fn listen_search(
    app: AppHandle,
    query: String,
    kind: String,
) -> Result<Vec<Entry>, String> {
    listen(&app)?.search(&query, &kind, 12).await
}

#[tauri::command]
pub async fn listen_channel(app: AppHandle, reference: String) -> Result<ChannelPage, String> {
    listen(&app)?.channel(&reference, 15).await
}

#[tauri::command]
pub async fn listen_videos(
    app: AppHandle,
    ids: Vec<String>,
    lang: String,
) -> Result<Vec<VideoInfo>, String> {
    Ok(listen(&app)?.videos(&ids, &lang).await)
}

#[tauri::command]
pub async fn listen_fetch(app: AppHandle, id: String, lang: String) -> Result<Fetched, String> {
    listen(&app)?.fetch(&id, &lang).await
}

/// The fetched track's bytes, raw (an ArrayBuffer on the JS side).
#[tauri::command]
pub async fn listen_audio(
    app: AppHandle,
    id: String,
    lang: String,
) -> Result<tauri::ipc::Response, String> {
    let path = listen(&app)?.audio_path(&id, &lang).await?;
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}
