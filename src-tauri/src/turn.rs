//! Native turn runner: the model's reply computed outside the WebView.
//!
//! Today every turn streams inside page JavaScript, so a backgrounded or
//! killed app loses the reply with nothing to show for it. This module
//! runs the same turn loop natively — chat POST, SSE read, `fetch_url`
//! tool rounds (reusing [`crate::fetch::fetch_page`]), follow-ups, final
//! answer — against a detached task the page's lifecycle cannot kill.
//! Tokens stream back as `turn-token` window events while the page is
//! alive; the finished turn always lands in a result file under the app
//! data dir, so a returning (or relaunched) page renders it instantly.
//! Nothing here touches UI state: the page owns placeholders, retries,
//! and the Fetching chip; Rust owns bytes, backoff, and files.
//!
//! Zero new crates: reqwest chunk reads, manual SSE split, backoff via
//! blocking sleep, serde_json already in the tree. The JNI service half
//! (keeping the process alive on Android) lives beside this module and
//! only extends survival — every path here is already correct without it.

use std::{
    collections::HashMap,
    future::Future,
    pin::Pin,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

/// Tool rounds per turn and calls per round: mirrors the TypeScript
/// provider (`MAX_TOOL_ROUNDS`, `MAX_CALLS_PER_ROUND` there), so both
/// engines stop in the same places.
const MAX_TOOL_ROUNDS: usize = 3;
const MAX_CALLS_PER_ROUND: usize = 3;
/// Whole-turn attempt budget: the first try plus this many recomputes
/// on retryable network failures (the user's "retry when the network
/// is back" — bounded, because every attempt spends tokens).
const MAX_ATTEMPTS: u32 = 3;
/// Backoff between attempts (attempt 1 waits BACKOFF[0], ...).
const BACKOFF_SECS: [u64; 2] = [2, 10];
/// A hung socket must not hold the service forever: an attempt older
/// than this reads as a retryable failure instead.
const ATTEMPT_DEADLINE_SECS: u64 = 600;
/// Grace after completion before a "reply ready" ping: a foreground
/// page marks the turn seen on its done event inside this window, so
/// only genuinely backgrounded turns ping.
const SEEN_GRACE_SECS: u64 = 5;

/// One history message, already flattened to text by the page (the
/// native path is text-only: chats with image attachments stay on the
/// TypeScript engine, which keeps multimodal parts).
#[derive(Clone, Deserialize)]
pub struct TurnWireMessage {
    pub role: String,
    pub content: String,
}

/// Everything the runner needs, snapshotted at send time. The API key
/// rides in memory only — it is never written to the result files.
#[derive(Clone, Deserialize)]
pub struct TurnRequest {
    pub turn_id: String,
    pub chat_id: String,
    /// The empty assistant placeholder the page appended before
    /// starting: boot scans match finished turns straight onto it.
    pub message_id: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    /// Provider-native thinking fields, computed by the existing
    /// TypeScript tables — Rust forwards them blindly, so provider
    /// quirks never need a second implementation here.
    pub extra_body: serde_json::Value,
    pub system: String,
    pub messages: Vec<TurnWireMessage>,
}

/// Finished-turn file: the contract the returning page polls.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TurnFile {
    pub turn_id: String,
    pub chat_id: String,
    pub message_id: String,
    pub status: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<TurnUsage>,
    pub finished_at: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TurnUsage {
    pub prompt: u64,
    pub completion: u64,
    pub total: u64,
}

#[derive(Clone, Serialize)]
struct TokenEvent {
    turn_id: String,
    token: String,
}

#[derive(Clone, Serialize)]
struct DoneEvent {
    turn_id: String,
    chat_id: String,
    status: String,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn turns_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e:?}"))?
        .join("turns");
    std::fs::create_dir_all(&dir).map_err(|e| format!("turns dir: {e}"))?;
    Ok(dir)
}

fn turn_path(app: &AppHandle, turn_id: &str) -> Result<std::path::PathBuf, String> {
    if turn_id.is_empty()
        || turn_id.len() > 64
        || !turn_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("bad turn id".to_string());
    }
    Ok(turns_dir(app)?.join(format!("{turn_id}.json")))
}

fn write_turn_file(app: &AppHandle, file: &TurnFile) -> Result<(), String> {
    let bytes =
        serde_json::to_vec_pretty(file).map_err(|e| format!("encode turn: {e}"))?;
    std::fs::write(turn_path(app, &file.turn_id)?, bytes)
        .map_err(|e| format!("write turn: {e}"))
}

/// Split freshly arrived SSE text into complete `data:` payloads,
/// keeping the trailing partial event in `remainder` for the next
/// chunk. Multi-line data joins with `\n`; `[DONE]` passes through
/// like any payload (the loop breaks on it).
fn extract_sse_payloads(remainder: &str, chunk: &str) -> (Vec<String>, String) {
    let mut text = String::with_capacity(remainder.len() + chunk.len());
    text.push_str(remainder);
    text.push_str(chunk);
    // SSE lines end CRLF, LF, or CR: normalize before splitting so a
    // `\r\n\r\n` boundary reads as the blank line it is (a stray `\r`
    // inside data is vanishingly rare; the split matters every stream).
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut payloads = Vec::new();
    let mut start = 0;
    while let Some(end) = text[start..].find("\n\n") {
        let block = &text[start..start + end];
        let mut data = String::new();
        for line in block.split('\n') {
            let line = line.strip_suffix('\r').unwrap_or(line);
            if let Some(value) = line.strip_prefix("data:") {
                if !data.is_empty() {
                    data.push('\n');
                }
                data.push_str(value.strip_prefix(' ').unwrap_or(value));
            }
        }
        payloads.push(data);
        start += end + 2;
    }
    (payloads, text[start..].to_string())
}

/// One fragmented tool call off the wire: index-joined by the caller.
#[derive(Clone, Debug, Default, PartialEq)]
struct ToolFrag {
    index: usize,
    id: String,
    name: String,
    args: String,
}

/// Content text plus tool-call fragments from one SSE data payload.
/// Unknown shapes read as empty (a skipped delta, never a failed turn).
fn delta_from_payload(payload: &str) -> (String, Vec<ToolFrag>) {
    let parsed: serde_json::Value = match serde_json::from_str(payload) {
        Ok(value) => value,
        Err(_) => return (String::new(), Vec::new()),
    };
    let delta = &parsed["choices"][0]["delta"];
    let content = delta["content"].as_str().unwrap_or("").to_string();
    let mut frags = Vec::new();
    if let Some(calls) = delta["tool_calls"].as_array() {
        for call in calls {
            frags.push(ToolFrag {
                index: call["index"].as_u64().unwrap_or(0) as usize,
                id: call["id"].as_str().unwrap_or("").to_string(),
                name: call["function"]["name"].as_str().unwrap_or("").to_string(),
                args: call["function"]["arguments"]
                    .as_str()
                    .unwrap_or("")
                    .to_string(),
            });
        }
    }
    (content, frags)
}

/// Machine code from [`crate::fetch::fetch_page`] to the one-sentence
/// copy the model reports (mirrors the TypeScript `fetchReason`).
fn fetch_error_copy(code: &str) -> String {
    match code {
        code if code.contains("timeout") || code.contains("timed out") => {
            "That page took too long.".to_string()
        }
        code if code.contains("too large") || code.contains("too-big") => {
            "That page is too large.".to_string()
        }
        _ => "That page couldn't be fetched.".to_string(),
    }
}

fn stream_body(req: &TurnRequest, history: &[serde_json::Value], tools: bool) -> serde_json::Value {
    let mut body = serde_json::json!({
        "model": req.model,
        "messages": history,
        "stream": true,
    });
    if let Some(map) = req.extra_body.as_object() {
        for (key, value) in map {
            body[key] = value.clone();
        }
    }
    if tools {
        body["tools"] = serde_json::json!([{
            "type": "function",
            "function": {
                "name": "fetch_url",
                "description": "Fetch a web page and return its readable text.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": { "type": "string", "description": "The full http(s) URL to fetch." }
                    },
                    "required": ["url"]
                }
            }
        }]);
        body["tool_choice"] = serde_json::json!("auto");
    }
    body
}

fn plain_body(req: &TurnRequest, history: &[serde_json::Value], tools: bool) -> serde_json::Value {
    let mut body = stream_body(req, history, tools);
    body["stream"] = serde_json::json!(false);
    body
}

fn wire_message(role: &str, content: &str) -> serde_json::Value {
    serde_json::json!({ "role": role, "content": content })
}

type PageFetch = Arc<
    dyn Fn(String) -> Pin<Box<dyn Future<Output = Result<String, String>> + Send>>
        + Send
        + Sync,
>;

fn default_page_fetch() -> PageFetch {
    Arc::new(|url: String| {
        Box::pin(async move { crate::fetch::fetch_page(url).await })
            as Pin<Box<dyn Future<Output = Result<String, String>> + Send>>
    })
}

/// One joined tool call: everything the history rebuild needs.
#[derive(Clone, Debug)]
struct ExecCall {
    id: String,
    url: String,
    name: String,
    args: String,
}

fn join_calls(frags: &[ToolFrag]) -> Vec<ExecCall> {
    let mut slots: HashMap<usize, ToolFrag> = HashMap::new();
    for frag in frags {
        let slot = slots.entry(frag.index).or_default();
        slot.index = frag.index;
        if !frag.id.is_empty() {
            slot.id = frag.id.clone();
        }
        slot.name.push_str(&frag.name);
        slot.args.push_str(&frag.args);
    }
    let mut out: Vec<ExecCall> = slots
        .into_values()
        .map(|slot| {
            let url = serde_json::from_str::<serde_json::Value>(&slot.args)
                .ok()
                .and_then(|v| v["url"].as_str().map(str::to_string))
                .unwrap_or_default();
            ExecCall {
                id: slot.id,
                url,
                name: slot.name,
                args: slot.args,
            }
        })
        // Unknown tools, id-less fragments, and empty URLs never
        // execute — same filter the TypeScript engine applies.
        .filter(|call| {
            !call.id.is_empty() && call.name == "fetch_url" && !call.url.is_empty()
        })
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

fn raw_tool_call(call: &ExecCall) -> serde_json::Value {
    serde_json::json!({
        "id": call.id,
        "type": "function",
        "function": { "name": call.name, "arguments": call.args }
    })
}

fn usage_from(value: &serde_json::Value) -> Option<TurnUsage> {
    let usage = &value["usage"];
    if usage.is_null() {
        return None;
    }
    let prompt = usage["prompt_tokens"].as_u64().unwrap_or(0);
    let completion = usage["completion_tokens"].as_u64().unwrap_or(0);
    let total = usage["total_tokens"]
        .as_u64()
        .unwrap_or(prompt + completion);
    Some(TurnUsage {
        prompt,
        completion,
        total,
    })
}

/// How one attempt ended: recompute, fail, or user stop.
enum AttemptEnd {
    Retryable,
    Fatal(String),
    Stopped,
}

struct AttemptEvents {
    on_token: Box<dyn FnMut(String) + Send>,
    on_retry_note: Box<dyn FnMut() + Send>,
    on_fetch: Box<dyn FnMut(bool, String) + Send>,
    stop: Arc<AtomicBool>,
}

#[derive(Clone, Serialize)]
struct FetchEvent {
    turn_id: String,
    phase: String,
    url: String,
}

fn reqwest_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "http client failed".to_string())
}

fn classify_send_error(error: reqwest::Error) -> AttemptEnd {
    // Send-time failures are transport by construction (statuses arrive
    // as responses, never errors): timeouts, refused/reset/closed
    // connections, and bodies cut mid-write all recompute the turn.
    // Only builder-class programmer errors fail outright.
    if error.is_builder() {
        return AttemptEnd::Fatal(format!("request failed: {error}"));
    }
    AttemptEnd::Retryable
}

/// Read one SSE stream into content + joined tool fragments, emitting
/// tokens as they land. Transport cuts read as retryable (the turn
/// recomputes); the deadline guards hung sockets.
async fn read_stream(
    res: reqwest::Response,
    deadline: Instant,
    ev: &mut AttemptEvents,
) -> Result<(String, Vec<ToolFrag>, Option<TurnUsage>), AttemptEnd> {
    let mut response = res;
    let mut text = String::new();
    let mut remainder = String::new();
    let mut content = String::new();
    let mut frags: Vec<ToolFrag> = Vec::new();
    let mut usage: Option<TurnUsage> = None;
    loop {
        if ev.stop.load(Ordering::Relaxed) {
            return Err(AttemptEnd::Stopped);
        }
        if Instant::now() > deadline {
            return Err(AttemptEnd::Retryable);
        }
        match response.chunk().await {
            Ok(Some(bytes)) => {
                text.push_str(&String::from_utf8_lossy(&bytes));
                let (payloads, rest) = extract_sse_payloads(&remainder, &text);
                remainder = rest;
                text.clear();
                for payload in payloads {
                    if payload.trim() == "[DONE]" {
                        break;
                    }
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&payload) {
                        if let Some(found) = usage_from(&value) {
                            usage = Some(found);
                        }
                    }
                    let (token, frag) = delta_from_payload(&payload);
                    if !token.is_empty() {
                        content.push_str(&token);
                        (ev.on_token)(token);
                    }
                    frags.extend(frag);
                }
            }
            Ok(None) => break,
            Err(error) => {
                // Same transport rule as send-time: a cut stream
                // recomputes, whatever the hyper spelling.
                if error.is_builder() {
                    return Err(AttemptEnd::Fatal(format!("stream failed: {error}")));
                }
                return Err(AttemptEnd::Retryable);
            }
        }
    }
    Ok((content, frags, usage))
}

async fn post_stream(
    client: &reqwest::Client,
    req: &TurnRequest,
    history: &[serde_json::Value],
    tools: bool,
    deadline: Instant,
    ev: &mut AttemptEvents,
) -> Result<(u16, String, Vec<ToolFrag>, Option<TurnUsage>), AttemptEnd> {
    let mut post = client
        .post(format!("{}/chat/completions", req.base_url.trim_end_matches('/')))
        .header("Content-Type", "application/json")
        .header("Accept", "text/event-stream");
    if !req.api_key.is_empty() {
        post = post.bearer_auth(&req.api_key);
    }
    // No `json` feature on this reqwest (see Cargo.toml): the body
    // goes out as pre-encoded bytes with the header set above.
    let encoded =
        serde_json::to_vec(&stream_body(req, history, tools)).map_err(|error| {
            AttemptEnd::Fatal(format!("encode request: {error}"))
        })?;
    let res = post
        .body(encoded)
        .send()
        .await
        .map_err(classify_send_error)?;
    // A tools rejection reads as a plain turn, exactly like TypeScript's
    // 400 fallback — the reply still lands, just without page fetches.
    if res.status().as_u16() == 400 && tools {
        return Ok((400, String::new(), Vec::new(), None));
    }
    if !res.status().is_success() {
        let status = res.status().as_u16();
        let head = res.text().await.unwrap_or_default();
        let head: String = head.chars().take(300).collect();
        return Err(AttemptEnd::Fatal(format!(
            "stream failed (HTTP {status}): {head}"
        )));
    }
    read_stream(res, deadline, ev)
        .await
        .map(|(content, frags, usage)| (200, content, frags, usage))
}

async fn post_plain(
    client: &reqwest::Client,
    req: &TurnRequest,
    history: &[serde_json::Value],
    tools: bool,
) -> Result<(String, Vec<ToolFrag>, Option<TurnUsage>), AttemptEnd> {
    let mut post = client
        .post(format!("{}/chat/completions", req.base_url.trim_end_matches('/')))
        .header("Content-Type", "application/json");
    if !req.api_key.is_empty() {
        post = post.bearer_auth(&req.api_key);
    }
    let encoded =
        serde_json::to_vec(&plain_body(req, history, tools)).map_err(|error| {
            AttemptEnd::Fatal(format!("encode request: {error}"))
        })?;
    let res = post
        .body(encoded)
        .send()
        .await
        .map_err(classify_send_error)?;
    if !res.status().is_success() {
        let status = res.status().as_u16();
        let head = res.text().await.unwrap_or_default();
        let head: String = head.chars().take(300).collect();
        return Err(AttemptEnd::Fatal(format!(
            "request failed (HTTP {status}): {head}"
        )));
    }
    // No `json` feature either: read bytes, parse by hand. Transport
    // cuts stay retryable; malformed payloads fail the turn (a second
    // identical response would parse the same way).
    let bytes = res.bytes().await.map_err(|error| {
        if error.is_timeout() || error.is_connect() || error.is_body() {
            AttemptEnd::Retryable
        } else {
            AttemptEnd::Fatal(format!("bad response: {error}"))
        }
    })?;
    let json: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|error| AttemptEnd::Fatal(format!("bad response: {error}")))?;
    let message = &json["choices"][0]["message"];
    let content = message["content"].as_str().unwrap_or("").to_string();
    let mut frags = Vec::new();
    if let Some(calls) = message["tool_calls"].as_array() {
        for (index, call) in calls.iter().enumerate() {
            frags.push(ToolFrag {
                index,
                id: call["id"].as_str().unwrap_or("").to_string(),
                name: call["function"]["name"].as_str().unwrap_or("").to_string(),
                args: call["function"]["arguments"]
                    .as_str()
                    .unwrap_or("")
                    .to_string(),
            });
        }
    }
    Ok((content, frags, usage_from(&json)))
}

/// One full attempt: stream (with tools), fetch rounds, final stream.
/// Credentials mirror the TypeScript provider: Bearer auth when a key
/// exists, no credential header for keyless servers.
async fn run_attempt(
    client: &reqwest::Client,
    req: &TurnRequest,
    page_fetch: &PageFetch,
    ev: &mut AttemptEvents,
) -> Result<(String, Option<TurnUsage>), AttemptEnd> {
    let deadline = Instant::now() + Duration::from_secs(ATTEMPT_DEADLINE_SECS);
    let mut history: Vec<serde_json::Value> = Vec::new();
    history.push(wire_message("system", &req.system));
    for message in &req.messages {
        history.push(wire_message(&message.role, &message.content));
    }
    let (status, first_content, first_frags, first_usage) =
        post_stream(client, req, &history, true, deadline, ev).await?;
    // 400 with tools: providers that reject tool calls get one plain
    // turn, same fallback the TypeScript engine applies.
    if status == 400 {
        let (content, _, usage) = post_stream_plain_fallback(client, req, &history, deadline, ev).await?;
        return Ok((content, usage.or(first_usage)));
    }
    let mut pending = join_calls(&first_frags)
        .into_iter()
        .take(MAX_CALLS_PER_ROUND)
        .collect::<Vec<_>>();
    if pending.is_empty() {
        return Ok((first_content, first_usage));
    }
    let mut usage = first_usage;
    let mut assistant_text = first_content;
    for _ in 0..MAX_TOOL_ROUNDS {
        if pending.is_empty() {
            break;
        }
        if ev.stop.load(Ordering::Relaxed) {
            return Err(AttemptEnd::Stopped);
        }
        history.push(serde_json::json!({
            "role": "assistant",
            "content": assistant_text,
            "tool_calls": pending.iter().map(raw_tool_call).collect::<Vec<_>>()
        }));
        for call in &pending {
            if ev.stop.load(Ordering::Relaxed) {
                return Err(AttemptEnd::Stopped);
            }
            // The page's Fetching chip reads this bracket — same contract
            // as the TypeScript provider's onFetchStart/onFetchEnd, so
            // both engines drive one indicator.
            (ev.on_fetch)(true, call.url.clone());
            let text = match page_fetch(call.url.clone()).await {
                Ok(text) => text,
                Err(code) => fetch_error_copy(&code),
            };
            (ev.on_fetch)(false, call.url.clone());
            history.push(serde_json::json!({
                "role": "tool",
                "content": text,
                "tool_call_id": call.id
            }));
        }
        let (content, frags, round_usage) = post_plain(client, req, &history, true).await?;
        if round_usage.is_some() {
            usage = round_usage;
        }
        assistant_text = content;
        pending = join_calls(&frags)
            .into_iter()
            .take(MAX_CALLS_PER_ROUND)
            .collect::<Vec<_>>();
    }
    let (_, final_content, _, final_usage) =
        post_stream(client, req, &history, false, deadline, ev).await?;
    Ok((final_content, final_usage.or(usage)))
}

async fn post_stream_plain_fallback(
    client: &reqwest::Client,
    req: &TurnRequest,
    history: &[serde_json::Value],
    deadline: Instant,
    ev: &mut AttemptEvents,
) -> Result<(String, Vec<ToolFrag>, Option<TurnUsage>), AttemptEnd> {
    let (status, content, frags, usage) =
        post_stream(client, req, history, false, deadline, ev).await?;
    if status == 400 {
        return Err(AttemptEnd::Fatal("request rejected (HTTP 400)".to_string()));
    }
    Ok((content, frags, usage))
}

/// Live-turn registry: stop and seen flags per turn id. Memory-only —
/// a dead process leaves result files behind, which is exactly how the
/// returning page tells finished from interrupted.
struct TurnLive {
    stop: Arc<AtomicBool>,
    seen: Arc<AtomicBool>,
}

static TURNS: OnceLock<Mutex<HashMap<String, Arc<TurnLive>>>> = OnceLock::new();

fn live_registry() -> &'static Mutex<HashMap<String, Arc<TurnLive>>> {
    TURNS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn live_turn(turn_id: &str) -> Arc<TurnLive> {
    let live = Arc::new(TurnLive {
        stop: Arc::new(AtomicBool::new(false)),
        seen: Arc::new(AtomicBool::new(false)),
    });
    if let Ok(mut registry) = live_registry().lock() {
        registry.insert(turn_id.to_string(), Arc::clone(&live));
    }
    live
}

fn drop_turn(turn_id: &str) {
    if let Ok(mut registry) = live_registry().lock() {
        registry.remove(turn_id);
    }
}

fn with_turn(turn_id: &str, f: impl FnOnce(&TurnLive)) -> bool {
    if let Ok(registry) = live_registry().lock() {
        if let Some(live) = registry.get(turn_id) {
            f(live);
            return true;
        }
    }
    false
}

/// Blocking sleep without new crates: parks a pool thread, never the
/// async worker, so other turns keep streaming during backoff.
async fn sleep_secs(secs: u64) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(Duration::from_secs(secs));
    })
    .await;
}

/// Fixed reply-ping id, shared with the frontend's
/// `REPLY_NOTIFICATION_ID` (studyMedia.ts): one ping replaces the
/// last, and every clearer (the 5s timer below, the foreground-return
/// dismiss) targets the same notice instead of stranding it.
const REPLY_NOTIFICATION_ID: i32 = 4201;

/// Notification plain text: strip the reply's markdown so the shade
/// never shows `**bold**`, backticks, headings, quotes, or link
/// targets. Display-only — the reply itself is untouched. Pure and
/// unit-tested.
fn notification_plain(head: &str) -> String {
    let inline = head.replace(['*', '`', '~'], "");
    let mut out = String::new();
    for line in inline.lines() {
        let t = line.trim_start();
        let t = t.strip_prefix('#').map(str::trim_start).unwrap_or(t);
        let t = t.strip_prefix('>').map(str::trim_start).unwrap_or(t);
        out.push_str(&link_text(t));
        out.push('\n');
    }
    out.replace('|', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// `[text](url)` (and `![alt](url)`) renders as its text in a ping.
fn link_text(line: &str) -> String {
    let mut out = String::new();
    let mut rest = line;
    while let Some(open) = rest.find('[') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        match after.find("](") {
            Some(close) => {
                out.push_str(&after[..close]);
                let target = &after[close + 2..];
                rest = match target.find(')') {
                    Some(end) => &target[end + 1..],
                    None => "",
                };
            }
            None => {
                out.push_str(after);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

fn notify_ready(app: &AppHandle, head: &str) {
    use tauri_plugin_notification::NotificationExt;
    let stripped = notification_plain(&head.chars().take(280).collect::<String>());
    let body: String = stripped.chars().take(140).collect();
    let _ = app
        .notification()
        .builder()
        .id(REPLY_NOTIFICATION_ID)
        .title("Reply ready")
        .body(if body.is_empty() {
            "Your reply finished while you were away.".to_string()
        } else {
            body
        })
        .show();
    // The shade is not storage: a native timer clears the ping after
    // 5s (the page's own timer freezes while backgrounded, which is
    // exactly when this ping exists). Same id the foreground return
    // dismisses, so a revisit clears it even sooner.
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(Duration::from_secs(5));
        let _ = handle.notification().cancel(vec![REPLY_NOTIFICATION_ID]);
    });
}

/// The detached turn: attempts with backoff, result file, done event,
/// and a background ping only when the page never marked it seen.
/// Stops release the service claim in `finally` fashion — every exit
/// path below runs the settle block.
async fn run_turn(app: AppHandle, req: TurnRequest, page_fetch: PageFetch) {
    let live = live_turn(&req.turn_id);
    // One event set per attempt (fresh closures, same shared flags).
    let mut make_events = || AttemptEvents {
        on_token: Box::new({
            let app = app.clone();
            let turn_id = req.turn_id.clone();
            move |token: String| {
                let _ = app.emit(
                    "turn-token",
                    TokenEvent {
                        turn_id: turn_id.clone(),
                        token,
                    },
                );
            }
        }),
        on_retry_note: Box::new({
            let app = app.clone();
            let turn_id = req.turn_id.clone();
            move || {
                let _ = app.emit(
                    "turn-retry",
                    TokenEvent {
                        turn_id: turn_id.clone(),
                        token: String::new(),
                    },
                );
            }
        }),
        on_fetch: Box::new({
            let app = app.clone();
            let turn_id = req.turn_id.clone();
            move |start: bool, url: String| {
                let _ = app.emit(
                    "turn-fetch",
                    FetchEvent {
                        turn_id: turn_id.clone(),
                        phase: if start { "start".to_string() } else { "end".to_string() },
                        url,
                    },
                );
            }
        }),
        // The registry's own flag: a stop raised mid-attempt (or during
        // backoff) lands on the next chunk check without re-wiring.
        stop: Arc::clone(&live.stop),
    };
    let outcome = match reqwest_client() {
        Ok(client) => drive_attempts(&client, &req, &page_fetch, &BACKOFF_SECS, &mut make_events).await,
        Err(error) => TurnOutcome::Failed(error),
    };
    match outcome {
        TurnOutcome::Done(content, usage) => {
            finish_turn(&app, &req, &live, Ok((content, usage))).await;
        }
        TurnOutcome::Stopped => {
            finish_turn(&app, &req, &live, Err("Reply stopped.".to_string())).await;
        }
        TurnOutcome::Failed(error) => {
            finish_turn(&app, &req, &live, Err(error)).await;
        }
    }
}

/// One turn's attempts with backoff, minus every AppHandle concern:
/// the event factory supplies fresh closures per attempt (shared stop
/// flag underneath), so tests drive the whole retry loop headless.
#[derive(Debug)]
enum TurnOutcome {
    Done(String, Option<TurnUsage>),
    Stopped,
    Failed(String),
}

async fn drive_attempts(
    client: &reqwest::Client,
    req: &TurnRequest,
    page_fetch: &PageFetch,
    backoff: &[u64],
    make_events: &mut (dyn FnMut() -> AttemptEvents + Send),
) -> TurnOutcome {
    let mut attempt: u32 = 0;
    loop {
        attempt += 1;
        let mut ev = make_events();
        match run_attempt(client, req, page_fetch, &mut ev).await {
            Ok((content, usage)) => return TurnOutcome::Done(content, usage),
            Err(AttemptEnd::Stopped) => return TurnOutcome::Stopped,
            Err(AttemptEnd::Fatal(error)) => return TurnOutcome::Failed(error),
            Err(AttemptEnd::Retryable) if attempt >= MAX_ATTEMPTS => {
                return TurnOutcome::Failed(
                    "The network kept dropping. Try again.".to_string(),
                )
            }
            Err(AttemptEnd::Retryable) => {
                (ev.on_retry_note)();
                let wait = backoff.get((attempt - 1) as usize).copied().unwrap_or(30);
                sleep_secs(wait).await;
                if ev.stop.load(Ordering::Relaxed) {
                    return TurnOutcome::Stopped;
                }
            }
        }
    }
}


async fn finish_turn(
    app: &AppHandle,
    req: &TurnRequest,
    live: &TurnLive,
    outcome: Result<(String, Option<TurnUsage>), String>,
) {
    let (status, content, error, usage) = match outcome {
        Ok((content, usage)) => ("done".to_string(), content, None, usage),
        Err(error) => ("error".to_string(), String::new(), Some(error), None),
    };
    let file = TurnFile {
        turn_id: req.turn_id.clone(),
        chat_id: req.chat_id.clone(),
        message_id: req.message_id.clone(),
        status: status.clone(),
        content: content.clone(),
        error: error.clone(),
        usage,
        finished_at: now_secs(),
    };
    let _ = write_turn_file(app, &file);
    let _ = app.emit(
        "turn-done",
        DoneEvent {
            turn_id: req.turn_id.clone(),
            chat_id: req.chat_id.clone(),
            status: status.clone(),
        },
    );
    drop_turn(&req.turn_id);
    turn_service_settle();
    // Foreground pages mark the turn seen on the done event inside the
    // grace window; backgrounded ones never do, and only they ping.
    sleep_secs(SEEN_GRACE_SECS).await;
    if !live.seen.load(Ordering::Relaxed) && status == "done" {
        notify_ready(app, &content);
    }
    let _ = error;
}

/// Start one native turn: validate, file the streaming record (so a
/// killed process still leaves a trace the page can read as
/// interrupted), spawn detached, and hold the Android service claim.
#[tauri::command]
pub fn turn_start(app: AppHandle, req: TurnRequest) -> Result<String, String> {
    if req.turn_id.is_empty() || req.chat_id.is_empty() || req.message_id.is_empty() {
        return Err("bad turn".to_string());
    }
    turn_path(&app, &req.turn_id)?;
    write_turn_file(
        &app,
        &TurnFile {
            turn_id: req.turn_id.clone(),
            chat_id: req.chat_id.clone(),
            message_id: req.message_id.clone(),
            status: "streaming".to_string(),
            content: String::new(),
            error: None,
            usage: None,
            finished_at: now_secs(),
        },
    )?;
    turn_service_claim();
    let spawned = req.clone();
    tauri::async_runtime::spawn(async move {
        run_turn(app, spawned, default_page_fetch()).await;
    });
    Ok(req.turn_id)
}

/// Read one turn's result file. Unknown ids (or unreadable files) read
/// as an error the page treats like any failed turn.
#[tauri::command]
pub fn turn_poll(app: AppHandle, turn_id: String) -> Result<TurnFile, String> {
    let bytes =
        std::fs::read(turn_path(&app, &turn_id)?).map_err(|_| "unknown turn".to_string())?;
    serde_json::from_slice(&bytes).map_err(|_| "bad turn file".to_string())
}

/// Every turn file on disk, newest last: the boot/return scan matches
/// finished turns to their placeholders and marks the rest interrupted.
#[tauri::command]
pub fn turn_scan(app: AppHandle) -> Result<Vec<TurnFile>, String> {
    let dir = turns_dir(&app)?;
    let mut entries = std::fs::read_dir(&dir)
        .map_err(|e| format!("turns dir: {e}"))?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .path()
                .extension()
                .is_some_and(|ext| ext == "json")
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| {
        entry
            .metadata()
            .and_then(|meta| meta.modified())
            .ok()
    });
    let mut out = Vec::new();
    for entry in entries {
        let bytes = match std::fs::read(entry.path()) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        if let Ok(file) = serde_json::from_slice::<TurnFile>(&bytes) {
            out.push(file);
        }
    }
    Ok(out)
}

/// Stop a live turn (user Stop). The runner settles it as stopped, so
/// the page renders the partial text with the usual stop state.
#[tauri::command]
pub fn turn_stop(turn_id: String) -> Result<bool, String> {
    Ok(with_turn(&turn_id, |live| {
        live.stop.store(true, Ordering::Relaxed);
    }))
}

/// The page marks a turn seen when its done event lands in a visible
/// window — the only turns that ping are the ones that finish while
/// nobody watches.
#[tauri::command]
pub fn turn_seen(turn_id: String) -> Result<bool, String> {
    Ok(with_turn(&turn_id, |live| {
        live.seen.store(true, Ordering::Relaxed);
    }))
}

/// Delete a consumed turn file. The page calls this after rendering a
/// background result, so relaunches never replay old answers.
#[tauri::command]
pub fn turn_dismiss(app: AppHandle, turn_id: String) -> Result<bool, String> {
    let path = turn_path(&app, &turn_id)?;
    match std::fs::remove_file(path) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("dismiss turn: {error}")),
    }
}

/// Android service claim: start on the first live turn, stop when the
/// last settles. Best-effort everywhere — a service failure must never
/// fail the turn itself, which already survives WebView suspension on
/// process life alone.
/// Owner demand (Sep 2026): never show the "Working on your reply"
/// notice. Android mandates a notification for every foreground
/// service, so the claim itself goes — turns run on process life
/// alone now. Consequence, stated plainly: a backgrounded app is
/// more likely to be killed mid-turn on aggressive OEM skins; killed
/// turns already reconcile as interrupted on return, and finished
/// ones land through the result file plus the Reply-ready ping.
#[cfg(target_os = "android")]
fn turn_service_claim() {}

/// Non-Android builds keep no service: the turn still outlives page
/// stalls wherever the process itself lives (desktop).
#[cfg(not(target_os = "android"))]
fn turn_service_claim() {}

#[cfg(target_os = "android")]
fn turn_service_settle() {
    crate::turn_service::service_settle();
}

#[cfg(not(target_os = "android"))]
fn turn_service_settle() {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn notification_plain_strips_markdown() {
        assert_eq!(
            notification_plain("**Bold** and `code` speak"),
            "Bold and code speak"
        );
        assert_eq!(
            notification_plain("# Head\n> quote [text](https://x.y/z) | cell"),
            "Head quote text cell"
        );
        assert_eq!(notification_plain(""), "");
        assert_eq!(notification_plain(" plain words "), "plain words");
    }

    #[test]
    fn sse_split_keeps_partial_events() {
        let (payloads, rest) =
            extract_sse_payloads("", "data: {\"a\":1}\n\ndata: {\"b\":");
        assert_eq!(payloads, vec!["{\"a\":1}".to_string()]);
        let (more, rest) = extract_sse_payloads(&rest, "2}\n\n");
        assert_eq!(more, vec!["{\"b\":2}".to_string()]);
        assert_eq!(rest, "");
    }

    #[test]
    fn sse_split_joins_multiline_data_and_crlf() {
        let (payloads, rest) =
            extract_sse_payloads("", "data: line1\r\ndata: line2\r\n\r\n");
        assert_eq!(payloads, vec!["line1\nline2".to_string()]);
        assert_eq!(rest, "");
    }

    #[test]
    fn delta_reads_content_and_tool_frags() {
        let (content, frags) = delta_from_payload(
            r#"{"choices":[{"delta":{"content":"hi","tool_calls":[{"index":0,"id":"c1","function":{"name":"fetch","arguments":"x"}}]}}]}"#,
        );
        assert_eq!(content, "hi");
        assert_eq!(
            frags,
            vec![ToolFrag {
                index: 0,
                id: "c1".to_string(),
                name: "fetch".to_string(),
                args: "x".to_string(),
            }]
        );
    }

    #[test]
    fn delta_tolerates_junk() {
        assert_eq!(
            delta_from_payload("not json"),
            (String::new(), Vec::new())
        );
        assert_eq!(delta_from_payload("{}"), (String::new(), Vec::new()));
    }

    #[test]
    fn calls_join_by_index_and_drop_unknown_tools() {
        let frags = vec![
            ToolFrag {
                index: 0,
                id: "c1".to_string(),
                name: "fetch".to_string(),
                args: String::new(),
            },
            ToolFrag {
                index: 0,
                id: String::new(),
                name: "_url".to_string(),
                args: r#"{"url":"https://a.test/"}"#.to_string(),
            },
            ToolFrag {
                index: 1,
                id: "c2".to_string(),
                name: "other_tool".to_string(),
                args: "{}".to_string(),
            },
        ];
        let calls = join_calls(&frags);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].id, "c1");
        assert_eq!(calls[0].url, "https://a.test/");
    }

    #[test]
    fn fetch_copy_maps_machine_codes() {
        assert_eq!(fetch_error_copy("timeout"), "That page took too long.");
        assert_eq!(fetch_error_copy("too-big"), "That page is too large.");
        assert_eq!(
            fetch_error_copy("failed"),
            "That page couldn't be fetched."
        );
    }

    #[test]
    fn bodies_offer_tools_first_and_merge_thinking() {
        let req = TurnRequest {
            turn_id: "t".to_string(),
            chat_id: "c".to_string(),
            message_id: "r".to_string(),
            base_url: "https://x.test/v1/".to_string(),
            api_key: "k".to_string(),
            model: "m".to_string(),
            extra_body: serde_json::json!({ "reasoning_effort": "low" }),
            system: "sys".to_string(),
            messages: vec![TurnWireMessage {
                role: "user".to_string(),
                content: "hi".to_string(),
            }],
        };
        let history = vec![wire_message("system", "sys")];
        let stream = stream_body(&req, &history, true);
        assert_eq!(stream["model"], "m");
        assert_eq!(stream["stream"], true);
        assert_eq!(stream["reasoning_effort"], "low");
        assert_eq!(stream["tools"][0]["function"]["name"], "fetch_url");
        assert!(plain_body(&req, &history, true)["stream"] == false);
        assert!(stream_body(&req, &history, false).get("tools").is_none());
    }

    enum StubStep {
        Respond {
            status: u16,
            content_type: &'static str,
            body: Vec<u8>,
        },
        Drop,
    }

    fn read_http_body(stream: &mut std::net::TcpStream) -> String {
        let mut head = Vec::new();
        let mut byte = [0u8; 1];
        while !head.windows(4).any(|w| w == b"\r\n\r\n") {
            if stream.read_exact(&mut byte).is_err() {
                break;
            }
            head.extend_from_slice(&byte);
            if head.len() > 65536 {
                break;
            }
        }
        let head_text = String::from_utf8_lossy(&head).into_owned();
        let length = head_text
            .lines()
            .find_map(|line| {
                line.strip_prefix("Content-Length:")
                    .or_else(|| line.strip_prefix("content-length:"))
                    .and_then(|v| v.trim().parse::<usize>().ok())
            })
            .unwrap_or(0);
        let mut body = vec![0u8; length];
        let mut read = 0;
        while read < length {
            match stream.read(&mut body[read..]) {
                Ok(0) => break,
                Ok(n) => read += n,
                Err(_) => break,
            }
        }
        String::from_utf8_lossy(&body[..read]).into_owned()
    }

    fn run_stub(script: Vec<StubStep>, bodies: Arc<Mutex<Vec<String>>>) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for step in script {
                let Ok((mut stream, _)) = listener.accept() else {
                    return;
                };
                match step {
                    // Read-then-drop: the retried request must arrive
                    // whole, so dropped attempts still record a body.
                    StubStep::Drop => {
                        let request = read_http_body(&mut stream);
                        bodies.lock().unwrap().push(request);
                    }
                    StubStep::Respond {
                        status,
                        content_type,
                        body,
                    } => {
                        let request = read_http_body(&mut stream);
                        bodies.lock().unwrap().push(request);
                        let reason = if status == 200 { "OK" } else { "Error" };
                        let head = format!(
                            "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            body.len()
                        );
                        let _ = stream.write_all(head.as_bytes());
                        let _ = stream.write_all(&body);
                    }
                }
            }
        });
        port
    }

    fn sse_tool_body(url: &str) -> Vec<u8> {
        let wire = serde_json::json!({
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_1",
                        "function": {
                            "name": "fetch_url",
                            "arguments": serde_json::json!({ "url": url }).to_string()
                        }
                    }]
                }
            }]
        });
        format!("data: {}\n\ndata: [DONE]\n\n", wire).into_bytes()
    }

    fn sse_text_body(text: &str) -> Vec<u8> {
        let wire =
            serde_json::json!({ "choices": [{ "delta": { "content": text } }] });
        format!("data: {}\n\ndata: [DONE]\n\n", wire).into_bytes()
    }

    fn json_followup_body() -> Vec<u8> {
        serde_json::json!({ "choices": [{ "message": { "content": "" } }] })
            .to_string()
            .into_bytes()
    }

    struct Recorder {
        tokens: Arc<Mutex<Vec<String>>>,
        fetches: Arc<Mutex<Vec<(bool, String)>>>,
        retries: Arc<Mutex<u32>>,
    }

    fn test_request(port: u16) -> TurnRequest {
        TurnRequest {
            turn_id: "t1".to_string(),
            chat_id: "c1".to_string(),
            message_id: "r1".to_string(),
            base_url: format!("http://127.0.0.1:{port}"),
            api_key: "k".to_string(),
            model: "m".to_string(),
            extra_body: serde_json::json!({}),
            system: "sys".to_string(),
            messages: vec![TurnWireMessage {
                role: "user".to_string(),
                content: "hi".to_string(),
            }],
        }
    }

    fn test_events(rec: &Recorder) -> AttemptEvents {
        let tokens = Arc::clone(&rec.tokens);
        let fetches = Arc::clone(&rec.fetches);
        let retries = Arc::clone(&rec.retries);
        AttemptEvents {
            on_token: Box::new(move |token: String| {
                tokens.lock().unwrap().push(token);
            }),
            on_retry_note: Box::new(move || {
                *retries.lock().unwrap() += 1;
            }),
            on_fetch: Box::new(move |start: bool, url: String| {
                fetches.lock().unwrap().push((start, url));
            }),
            stop: Arc::new(AtomicBool::new(false)),
        }
    }

    #[test]
    fn drive_runs_tool_round_then_streams_answer() {
        let bodies = Arc::new(Mutex::new(Vec::new()));
        let port = run_stub(
            vec![
                StubStep::Respond {
                    status: 200,
                    content_type: "text/event-stream",
                    body: sse_tool_body("http://example.test/page"),
                },
                StubStep::Respond {
                    status: 200,
                    content_type: "application/json",
                    body: json_followup_body(),
                },
                StubStep::Respond {
                    status: 200,
                    content_type: "text/event-stream",
                    body: sse_text_body("hi there"),
                },
            ],
            Arc::clone(&bodies),
        );
        let page_fetch: PageFetch = Arc::new(|url: String| {
            Box::pin(async move {
                assert_eq!(url, "http://example.test/page");
                Ok::<String, String>("page text here".to_string())
            })
                as Pin<Box<dyn Future<Output = Result<String, String>> + Send>>
        });
        let rec = Recorder {
            tokens: Arc::new(Mutex::new(Vec::new())),
            fetches: Arc::new(Mutex::new(Vec::new())),
            retries: Arc::new(Mutex::new(0)),
        };
        let client = reqwest_client().unwrap();
        let req = test_request(port);
        let outcome = tauri::async_runtime::block_on(drive_attempts(
            &client,
            &req,
            &page_fetch,
            &[0],
            &mut || test_events(&rec),
        ));
        match outcome {
            TurnOutcome::Done(content, _) => assert_eq!(content, "hi there"),
            other => panic!("expected done, got {other:?}"),
        }
        assert_eq!(*rec.tokens.lock().unwrap(), vec!["hi there"]);
        assert_eq!(
            *rec.fetches.lock().unwrap(),
            vec![(true, "http://example.test/page".to_string()), (false, "http://example.test/page".to_string())]
        );
        assert_eq!(*rec.retries.lock().unwrap(), 0);
        // Three requests; the follow-up carries the tool result.
        let bodies = bodies.lock().unwrap();
        assert_eq!(bodies.len(), 3);
        assert!(bodies[1].contains("call_1"));
        assert!(bodies[1].contains("page text here"));
    }

    #[test]
    fn drive_retries_a_dropped_connection_then_finishes() {
        let bodies = Arc::new(Mutex::new(Vec::new()));
        let port = run_stub(
            vec![
                StubStep::Drop,
                StubStep::Respond {
                    status: 200,
                    content_type: "text/event-stream",
                    body: sse_text_body("late hello"),
                },
            ],
            Arc::clone(&bodies),
        );
        let page_fetch: PageFetch = Arc::new(|_url: String| {
            Box::pin(async move { Ok::<String, String>("unused".to_string()) })
                as Pin<Box<dyn Future<Output = Result<String, String>> + Send>>
        });
        let rec = Recorder {
            tokens: Arc::new(Mutex::new(Vec::new())),
            fetches: Arc::new(Mutex::new(Vec::new())),
            retries: Arc::new(Mutex::new(0)),
        };
        let client = reqwest_client().unwrap();
        let req = test_request(port);
        let outcome = tauri::async_runtime::block_on(drive_attempts(
            &client,
            &req,
            &page_fetch,
            &[0],
            &mut || test_events(&rec),
        ));
        match outcome {
            TurnOutcome::Done(content, _) => assert_eq!(content, "late hello"),
            other => panic!("expected done, got {other:?}"),
        }
        assert_eq!(*rec.retries.lock().unwrap(), 1);
        assert_eq!(bodies.lock().unwrap().len(), 2);
    }
}
