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

/// The video's picture (H.264, no sound), raw: an ArrayBuffer on the
/// JS side, played muted beside the language track.
#[tauri::command]
pub async fn listen_video(app: AppHandle, id: String) -> Result<tauri::ipc::Response, String> {
    let path = listen(&app)?.video_path(&id).await?;
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// The fetched track's loudness envelope (one byte per 20 ms), raw:
/// the app lines the captions up with the audio's pauses from it.
#[tauri::command]
pub async fn listen_envelope(
    app: AppHandle,
    id: String,
    lang: String,
) -> Result<tauri::ipc::Response, String> {
    let bytes = listen(&app)?.envelope(&id, &lang).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Piece `n` of what the speech recognizer hears in the track, with
/// its words timed (`ccez_listen::heard`): the app moves the captions
/// onto those times. Mac only for now; elsewhere
/// `listen-heard-unsupported`.
#[tauri::command]
pub async fn listen_heard(
    app: AppHandle,
    id: String,
    lang: String,
    n: usize,
) -> Result<ccez_listen::HeardChunk, String> {
    let speech_lang = lang.clone();
    listen(&app)?
        .heard(&id, &lang, n, move |audio, start, end| {
            crate::heard_macos::recognize(audio, &speech_lang, start, end)
        })
        .await
}
