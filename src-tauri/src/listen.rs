//! Listening drills on desktop: the `ccez-listen` crate behind
//! commands (yt-dlp runs on this machine; clips cache under the app's
//! cache dir). Phones and the web build reach the same crate through
//! the `ccez-listen serve` binary instead.

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

async fn blocking<T: Send + 'static>(
    app: AppHandle,
    f: impl FnOnce(&Listen) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let l = listen(&app)?;
    tauri::async_runtime::spawn_blocking(move || f(l))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn listen_search(
    app: AppHandle,
    query: String,
    kind: String,
) -> Result<Vec<Entry>, String> {
    blocking(app, move |l| l.search(&query, &kind, 12)).await
}

#[tauri::command]
pub async fn listen_channel(app: AppHandle, reference: String) -> Result<ChannelPage, String> {
    blocking(app, move |l| l.channel(&reference, 15)).await
}

#[tauri::command]
pub async fn listen_videos(
    app: AppHandle,
    ids: Vec<String>,
    lang: String,
) -> Result<Vec<VideoInfo>, String> {
    blocking(app, move |l| Ok(l.videos(&ids, &lang))).await
}

#[tauri::command]
pub async fn listen_fetch(app: AppHandle, id: String, lang: String) -> Result<Fetched, String> {
    blocking(app, move |l| l.fetch(&id, &lang)).await
}

/// The fetched track's bytes, raw (an ArrayBuffer on the JS side).
#[tauri::command]
pub async fn listen_audio(
    app: AppHandle,
    id: String,
    lang: String,
) -> Result<tauri::ipc::Response, String> {
    let bytes = blocking(app, move |l| {
        let f = l.fetch(&id, &lang)?;
        std::fs::read(&f.audio_path).map_err(|e| e.to_string())
    })
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}
