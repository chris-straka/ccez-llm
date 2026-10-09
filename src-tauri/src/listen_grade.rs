//! Listening-drill grading in Rust, so translations keep coming while
//! the app is in the background (the phone's WebView pauses; this
//! doesn't). Same shape as native turns: the page builds each prompt
//! and hands over the provider config, the runner posts them two at a
//! time under the Android keep-alive claim, and every result lands in
//! a per-chat file plus a `listen-graded` event. A page that missed the
//! events (paused, or relaunched) reads the file back.

use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Semaphore;

/// Grading calls in flight at once, across all drills.
const CONCURRENCY: usize = 2;
/// One retry after a transport cut, 429 or 5xx.
const RETRY_AFTER: Duration = Duration::from_secs(2);
/// Result files older than this are swept at the next start.
const KEEP_SECS: u64 = 14 * 24 * 3600;
pub const GRADED_EVENT: &str = "listen-graded";

#[derive(Clone, Debug, Deserialize)]
pub struct GradeItem {
    pub i: u32,
    pub prompt: String,
    /// "Try again": run even if a reply is stored (it didn't parse).
    #[serde(default)]
    pub retry: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct GradeRequest {
    pub chat_id: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    #[serde(default)]
    pub extra_body: serde_json::Value,
    pub items: Vec<GradeItem>,
}

/// One clip's grading: the model's raw reply, or why it failed.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GradeResult {
    pub chat_id: String,
    pub i: u32,
    pub content: Option<String>,
    pub error: Option<String>,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn gate() -> &'static Arc<Semaphore> {
    static GATE: OnceLock<Arc<Semaphore>> = OnceLock::new();
    GATE.get_or_init(|| Arc::new(Semaphore::new(CONCURRENCY)))
}

/// `chat|i` keys queued or running, so a re-sent batch never doubles.
fn in_flight() -> &'static Mutex<HashSet<String>> {
    static LIVE: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    LIVE.get_or_init(Default::default)
}

/// Serializes writes to the result files.
fn file_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(Default::default)
}

fn safe_chat_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn grades_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("listen-grades"))
}

fn results_path(app: &AppHandle, chat_id: &str) -> Result<PathBuf, String> {
    if !safe_chat_id(chat_id) {
        return Err("bad chat id".into());
    }
    Ok(grades_dir(app)?.join(format!("{chat_id}.json")))
}

fn read_results(app: &AppHandle, chat_id: &str) -> BTreeMap<u32, GradeResult> {
    results_path(app, chat_id)
        .ok()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn store_result(app: &AppHandle, result: &GradeResult) {
    let _guard = file_lock().lock().unwrap_or_else(|p| p.into_inner());
    let Ok(path) = results_path(app, &result.chat_id) else {
        return;
    };
    let mut all = read_results(app, &result.chat_id);
    all.insert(result.i, result.clone());
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(bytes) = serde_json::to_vec(&all) {
        let tmp = path.with_extension("tmp");
        if std::fs::write(&tmp, bytes).is_ok() {
            let _ = std::fs::rename(&tmp, &path);
        }
    }
}

fn sweep_old(app: &AppHandle) {
    let Ok(dir) = grades_dir(app) else { return };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let cutoff = now_secs().saturating_sub(KEEP_SECS);
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .is_some_and(|t| t.as_secs() < cutoff);
        if old {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// The request body: one user message, the provider's thinking fields.
fn body(req: &GradeRequest, prompt: &str) -> serde_json::Value {
    let mut body = serde_json::json!({
        "model": req.model,
        "messages": [{ "role": "user", "content": prompt }],
        "stream": false,
    });
    if let Some(map) = req.extra_body.as_object() {
        for (key, value) in map {
            body[key] = value.clone();
        }
    }
    body
}

enum Attempt {
    Done(String),
    Retry(String),
    Fail(String),
}

async fn post_once(client: &reqwest::Client, req: &GradeRequest, prompt: &str) -> Attempt {
    let mut post = client
        .post(format!(
            "{}/chat/completions",
            req.base_url.trim_end_matches('/')
        ))
        .header("Content-Type", "application/json")
        .body(body(req, prompt).to_string());
    if !req.api_key.is_empty() {
        post = post.bearer_auth(&req.api_key);
    }
    let res = match post.send().await {
        Ok(res) => res,
        Err(e) => return Attempt::Retry(format!("request failed: {e}")),
    };
    let status = res.status().as_u16();
    if !res.status().is_success() {
        let head: String = res
            .text()
            .await
            .unwrap_or_default()
            .chars()
            .take(200)
            .collect();
        let message = format!("HTTP {status}: {head}");
        return if status == 429 || status >= 500 {
            Attempt::Retry(message)
        } else {
            Attempt::Fail(message)
        };
    }
    let bytes = match res.bytes().await {
        Ok(b) => b,
        Err(e) => return Attempt::Retry(format!("read failed: {e}")),
    };
    match serde_json::from_slice::<serde_json::Value>(&bytes) {
        Ok(json) => Attempt::Done(
            json["choices"][0]["message"]["content"]
                .as_str()
                .unwrap_or("")
                .to_string(),
        ),
        Err(e) => Attempt::Fail(format!("bad response: {e}")),
    }
}

async fn grade_one(client: &reqwest::Client, req: &GradeRequest, item: &GradeItem) -> GradeResult {
    let mut outcome = post_once(client, req, &item.prompt).await;
    if matches!(outcome, Attempt::Retry(_)) {
        tokio::time::sleep(RETRY_AFTER).await;
        outcome = post_once(client, req, &item.prompt).await;
    }
    let (content, error) = match outcome {
        Attempt::Done(text) => (Some(text), None),
        Attempt::Retry(e) | Attempt::Fail(e) => (None, Some(e)),
    };
    GradeResult {
        chat_id: req.chat_id.clone(),
        i: item.i,
        content,
        error,
    }
}

/// Queue a drill's gradings. Items already queued or running are
/// skipped, and so are answered ones unless `retry`; failed ones run
/// again.
#[tauri::command]
pub fn listen_grade_start(app: AppHandle, req: GradeRequest) -> Result<(), String> {
    results_path(&app, &req.chat_id)?;
    sweep_old(&app);
    let done = read_results(&app, &req.chat_id);
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|_| "http client failed".to_string())?;
    let req = Arc::new(req);
    for item in req.items.iter().cloned() {
        if !item.retry && done.get(&item.i).is_some_and(|r| r.content.is_some()) {
            continue;
        }
        let key = format!("{}|{}", req.chat_id, item.i);
        if !in_flight()
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(key.clone())
        {
            continue;
        }
        let (app, req, client) = (app.clone(), req.clone(), client.clone());
        crate::turn::turn_service_claim(&req.chat_id);
        tauri::async_runtime::spawn(async move {
            let result = match gate().clone().acquire_owned().await {
                Ok(_permit) => grade_one(&client, &req, &item).await,
                Err(_) => GradeResult {
                    chat_id: req.chat_id.clone(),
                    i: item.i,
                    content: None,
                    error: Some("grading closed".into()),
                },
            };
            store_result(&app, &result);
            let _ = app.emit(GRADED_EVENT, &result);
            in_flight()
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .remove(&key);
            crate::turn::turn_service_settle();
        });
    }
    Ok(())
}

/// Every stored result for one drill chat (the page lands them again
/// after a pause or relaunch; landing is idempotent).
#[tauri::command]
pub fn listen_grade_results(app: AppHandle, chat_id: String) -> Result<Vec<GradeResult>, String> {
    results_path(&app, &chat_id)?;
    Ok(read_results(&app, &chat_id).into_values().collect())
}

/// Drop a drill's results (its chat was deleted).
#[tauri::command]
pub fn listen_grade_forget(app: AppHandle, chat_id: String) -> Result<(), String> {
    let path = results_path(&app, &chat_id)?;
    let _guard = file_lock().lock().unwrap_or_else(|p| p.into_inner());
    let _ = std::fs::remove_file(path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> GradeRequest {
        GradeRequest {
            chat_id: "c1".into(),
            base_url: "https://api.example/v1".into(),
            api_key: "k".into(),
            model: "m".into(),
            extra_body: serde_json::json!({ "reasoning_effort": "low" }),
            items: vec![],
        }
    }

    #[test]
    fn body_is_one_user_message_with_thinking_fields() {
        let b = body(&request(), "Translate «Bonjour».");
        assert_eq!(b["model"], "m");
        assert_eq!(b["stream"], false);
        assert_eq!(b["messages"][0]["role"], "user");
        assert_eq!(b["messages"][0]["content"], "Translate «Bonjour».");
        assert_eq!(b["reasoning_effort"], "low");
    }

    #[test]
    fn chat_ids_are_file_safe() {
        assert!(safe_chat_id("2f6c1a-chat_9"));
        assert!(!safe_chat_id(""));
        assert!(!safe_chat_id("../etc"));
        assert!(!safe_chat_id("a/b"));
    }
}
