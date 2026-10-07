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
/// Extra streamed rounds when the final answer keeps calling fetch
/// (each retracts its prefix, runs the calls, and re-streams):
/// mirrors `EXTRA_FINAL_ROUNDS` there.
const EXTRA_FINAL_ROUNDS: usize = 2;
/// Whole-turn attempt budget: the first try plus this many recomputes
/// on retryable network failures (the user's "retry when the network
/// is back" — bounded, because every attempt spends tokens).
const MAX_ATTEMPTS: u32 = 3;
/// Backoff between attempts (attempt 1 waits BACKOFF[0], ...).
const BACKOFF_SECS: [u64; 2] = [2, 10];
/// A hung socket must not hold the service forever: an attempt older
/// than this reads as a retryable failure instead.
const ATTEMPT_DEADLINE_SECS: u64 = 600;

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
    /// Rolling-summary inputs, computed by the page's shared window
    /// rule (`nativeHistoryInput`): the prior summary ("" when none)
    /// plus the overflow fold to refresh first ("" when no fold is
    /// pending). Defaulted so older senders still parse.
    #[serde(default)]
    pub prior_summary: String,
    #[serde(default)]
    pub fold_text: String,
    #[serde(default)]
    pub fold_through: String,
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
    /// Refreshed rolling summary plus the watermark id it covers:
    /// present only when this turn folded (even on failed turns —
    /// the fold work stands). The page persists both onto the chat.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary_through: Option<String>,
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

/// Byte-level SSE reader over `extract_sse_payloads`: network chunks
/// can cut a UTF-8 character or a CRLF in half, so the trailing partial
/// character and a trailing `\r` wait for the next chunk instead of
/// decoding as U+FFFD or as an extra blank line.
#[derive(Default)]
struct SseDecoder {
    bytes: Vec<u8>,
    remainder: String,
}

impl SseDecoder {
    fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.bytes.extend_from_slice(chunk);
        let mut keep = match std::str::from_utf8(&self.bytes) {
            Ok(_) => 0,
            // An incomplete character at the end (no error length).
            Err(e) if e.error_len().is_none() => self.bytes.len() - e.valid_up_to(),
            Err(_) => 0,
        };
        if keep == 0 && self.bytes.last() == Some(&b'\r') {
            keep = 1;
        }
        let tail = self.bytes.split_off(self.bytes.len() - keep);
        let text = String::from_utf8_lossy(&self.bytes).into_owned();
        self.bytes = tail;
        let (payloads, rest) = extract_sse_payloads(&self.remainder, &text);
        self.remainder = rest;
        payloads
    }

    /// The stream ended: a last event without its blank line still counts.
    fn finish(&mut self) -> Vec<String> {
        let text = String::from_utf8_lossy(&std::mem::take(&mut self.bytes)).into_owned();
        let (mut payloads, rest) =
            extract_sse_payloads(&std::mem::take(&mut self.remainder), &text);
        if rest.lines().any(|line| line.starts_with("data:")) {
            payloads.extend(extract_sse_payloads(&rest, "\n\n").0);
        }
        payloads
    }
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

/// Stored summary cap (chars): mirrors `MAX_SUMMARY_CHARS` in chat.ts.
const MAX_SUMMARY_CHARS: usize = 2500;

/// Refresh instruction: mirrors `buildSummaryRefreshMessages` in
/// chat.ts (the 400 words mirror `SUMMARY_WORDS`) — both engines
/// fold overflow into the same shape.
const SUMMARY_REFRESH_SYSTEM: &str = "Summarize the earlier part of an ongoing chat so a future reply can use it as context. Keep names, decisions, open questions, and language-learning goals. Third person, at most 400 words, plain prose.";

/// Summary as the model reads it: mirrors `summaryBlock` in chat.ts
/// — keep the marker text identical.
fn summary_block(summary: &str) -> String {
    format!("Earlier in this chat (summarized for context, not verbatim):\n{summary}")
}

/// Refresh user text: mirrors the second message of
/// `buildSummaryRefreshMessages` in chat.ts.
fn refresh_user_text(prior: &str, fold: &str) -> String {
    if prior.is_empty() {
        fold.to_string()
    } else {
        format!("Previous summary:\n{prior}\n\nMore history:\n{fold}")
    }
}

/// One refreshed summary plus the watermark id it covers, for the
/// result file (the page persists both onto the chat).
struct SummaryRefresh {
    text: String,
    through: String,
}

/// Rolling-summary resolve, once per turn (not per attempt): when the
/// page folded overflowed history, one non-streaming POST merges it
/// into a fresh summary; otherwise the prior text stands. A failed
/// refresh falls back to the prior summary — the turn still runs
/// windowed — so only the (to_use, refreshed) pair escapes.
async fn resolve_summary(
    client: &reqwest::Client,
    req: &TurnRequest,
) -> (String, Option<String>) {
    if req.fold_text.is_empty() {
        return (req.prior_summary.clone(), None);
    }
    let history = vec![
        wire_message("system", SUMMARY_REFRESH_SYSTEM),
        wire_message("user", &refresh_user_text(&req.prior_summary, &req.fold_text)),
    ];
    match post_plain(client, req, &history, false).await {
        Ok((content, _, _)) => {
            let trimmed = content.trim();
            if trimmed.is_empty() {
                (req.prior_summary.clone(), None)
            } else {
                let capped: String = trimmed.chars().take(MAX_SUMMARY_CHARS).collect();
                (capped.clone(), Some(capped))
            }
        }
        Err(_) => (req.prior_summary.clone(), None),
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
                "description": "Fetch a web page and return its readable text. Use this when the user asks about a URL or when current/external facts would answer better than training data. The user doesn't know it exists. Do not use it when no external information is required. It returns the page text (truncated when long) or a one-line error — never raw HTML. RSS/Atom feeds work too and are the best route to recent news: a feed returns its latest headlines as one line each. Prefer a feed URL you know for the outlet asked about. Call it at once when you need a page — never write that you will fetch without calling. When a fetch fails, call again with a different URL instead of stopping. To search the web, fetch https://html.duckduckgo.com/html/?q=<url-encoded query>: it returns the top results as one line each with their URLs, so fetch the best result next instead of guessing a URL.",
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
        // Same cleaning as the TypeScript executor (`fetchPageText`):
        // the model reads text, never raw markup.
        Box::pin(async move {
            let markup = crate::fetch::fetch_page(url.clone()).await?;
            Ok(crate::page_text::tool_text(&url, &markup))
        })
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
    /// Recompute the turn; the note surfaces when attempts exhaust.
    /// None keeps the friendly transport note (never blame the radio);
    /// Some carries the server's own verdict (rate limit, overload).
    Retryable(Option<String>),
    Fatal(String),
    Stopped,
}

/// HTTP statuses worth another attempt (bounded by MAX_ATTEMPTS):
/// 429 rate limits and 5xx overloads are transient by nature — the
/// provider's own "please retry" — while other 4xx (bad key, bad
/// request) would fail identically again.
fn retryable_http_status(status: u16) -> bool {
    status == 429 || status >= 500
}

struct AttemptEvents {
    on_token: Box<dyn FnMut(String) + Send>,
    on_retry_note: Box<dyn FnMut() + Send>,
    on_round_retract: Box<dyn FnMut() + Send>,
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
    AttemptEnd::Retryable(None)
}

/// Fold stream payloads into the reply: tokens, tool fragments, usage.
fn take_payloads(
    payloads: Vec<String>,
    content: &mut String,
    frags: &mut Vec<ToolFrag>,
    usage: &mut Option<TurnUsage>,
    ev: &mut AttemptEvents,
) {
    for payload in payloads {
        if payload.trim() == "[DONE]" {
            break;
        }
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&payload) {
            if let Some(found) = usage_from(&value) {
                *usage = Some(found);
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

/// Read one SSE stream into content + joined tool fragments, emitting
/// tokens as they land. Transport cuts read as retryable (the turn
/// recomputes); the deadline guards hung sockets.
async fn read_stream(
    res: reqwest::Response,
    deadline: Instant,
    ev: &mut AttemptEvents,
) -> Result<(String, Vec<ToolFrag>, Option<TurnUsage>), AttemptEnd> {
    let mut response = res;
    let mut decoder = SseDecoder::default();
    let mut content = String::new();
    let mut frags: Vec<ToolFrag> = Vec::new();
    let mut usage: Option<TurnUsage> = None;
    loop {
        if ev.stop.load(Ordering::Relaxed) {
            return Err(AttemptEnd::Stopped);
        }
        if Instant::now() > deadline {
            return Err(AttemptEnd::Retryable(None));
        }
        match response.chunk().await {
            Ok(Some(bytes)) => take_payloads(
                decoder.push(&bytes),
                &mut content,
                &mut frags,
                &mut usage,
                ev,
            ),
            Ok(None) => {
                take_payloads(decoder.finish(), &mut content, &mut frags, &mut usage, ev);
                break;
            }
            Err(error) => {
                // Same transport rule as send-time: a cut stream
                // recomputes, whatever the hyper spelling.
                if error.is_builder() {
                    return Err(AttemptEnd::Fatal(format!("stream failed: {error}")));
                }
                return Err(AttemptEnd::Retryable(None));
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
    // The body rides along as the content so a later round can report
    // the server's reason (see `rejected_400`).
    if res.status().as_u16() == 400 && tools {
        let head = res.text().await.unwrap_or_default();
        return Ok((400, head.chars().take(300).collect(), Vec::new(), None));
    }
    if !res.status().is_success() {
        let status = res.status().as_u16();
        let head = res.text().await.unwrap_or_default();
        let head: String = head.chars().take(300).collect();
        let message = format!("stream failed (HTTP {status}): {head}");
        return Err(if retryable_http_status(status) {
            AttemptEnd::Retryable(Some(message))
        } else {
            AttemptEnd::Fatal(message)
        });
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
        let message = format!("request failed (HTTP {status}): {head}");
        return Err(if retryable_http_status(status) {
            AttemptEnd::Retryable(Some(message))
        } else {
            AttemptEnd::Fatal(message)
        });
    }
    // No `json` feature either: read bytes, parse by hand. Transport
    // cuts stay retryable; malformed payloads fail the turn (a second
    // identical response would parse the same way).
    let bytes = res.bytes().await.map_err(|error| {
        if error.is_timeout() || error.is_connect() || error.is_body() {
            AttemptEnd::Retryable(None)
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

/// One fetch batch run into the history: the assistant tool_calls
/// message first, then each page's text (or its one-line failure) as
/// a tool result. Stop-aware; the fetch bracket wraps each page.
/// Shared by the follow-up rounds and the extra final rounds below.
async fn run_fetch_batch(
    history: &mut Vec<serde_json::Value>,
    assistant_text: &str,
    pending: &[ExecCall],
    page_fetch: &PageFetch,
    ev: &mut AttemptEvents,
) -> Result<(), AttemptEnd> {
    if ev.stop.load(Ordering::Relaxed) {
        return Err(AttemptEnd::Stopped);
    }
    history.push(serde_json::json!({
        "role": "assistant",
        "content": assistant_text,
        "tool_calls": pending.iter().map(raw_tool_call).collect::<Vec<_>>()
    }));
    for call in pending {
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
    Ok(())
}

/// One full attempt: stream (with tools), fetch rounds, final stream
/// (with tools still on, so a last retry can act). A follow-up that
/// answers with no calls IS the reply.
/// Credentials mirror the TypeScript provider: Bearer auth when a key
/// exists, no credential header for keyless servers.
async fn run_attempt(
    client: &reqwest::Client,
    req: &TurnRequest,
    summary: &str,
    page_fetch: &PageFetch,
    ev: &mut AttemptEvents,
) -> Result<(String, Option<TurnUsage>), AttemptEnd> {
    let deadline = Instant::now() + Duration::from_secs(ATTEMPT_DEADLINE_SECS);
    let mut history: Vec<serde_json::Value> = Vec::new();
    history.push(wire_message("system", &req.system));
    // Resolved rolling summary (same position as the TypeScript
    // engine's second system message): the page sends windowed turns
    // plus, when a fold was pending, no block at all — the resolved
    // text here is the only summary the history ever holds.
    if !summary.is_empty() {
        history.push(wire_message("system", &summary_block(summary)));
    }
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
        // Only unusable calls (unknown tool, no URL, cut-off arguments)
        // and no text: ask once more without tools rather than file a
        // blank reply. Same rule as the TypeScript engine.
        if first_content.trim().is_empty() && !first_frags.is_empty() {
            let (content, _, usage) =
                post_stream_plain_fallback(client, req, &history, deadline, ev).await?;
            return Ok((content, usage.or(first_usage)));
        }
        return Ok((first_content, first_usage));
    }
    // Tool round: the streamed prefix was provisional chatter, not the
    // answer — retract it (the page clears back to thinking dots)
    // before the fetch runs, so the reply never shows text the final
    // round later replaces. Same wire event as a transport retry: both
    // mean "discard the prefix, starting over".
    (ev.on_round_retract)();
    let mut usage = first_usage;
    let mut assistant_text = first_content;
    for round in 0..MAX_TOOL_ROUNDS {
        if pending.is_empty() {
            break;
        }
        run_fetch_batch(&mut history, &assistant_text, &pending, page_fetch, ev).await?;
        // The last batch goes straight to the streamed answer (as in
        // the TypeScript engine): a plain follow-up here could only ask
        // for fetches nothing would run.
        if round + 1 >= MAX_TOOL_ROUNDS {
            break;
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
        if pending.is_empty() && !assistant_text.is_empty() {
            // The follow-up is the answer (no more calls): emit it as
            // the reply instead of discarding it and re-asking — the
            // re-ask regenerated blind and stalled promising retries
            // it could never make (its tools were off).
            (ev.on_token)(assistant_text.clone());
            return Ok((assistant_text, usage));
        }
    }
    // The final answer streams WITH tools: after failed fetches the
    // model often wants one more source, and with tools off that
    // promise always stalled. Calls here run bounded extra rounds
    // (retract the prefix, fetch, re-stream) before the reply must
    // land.
    let mut extra = 0;
    loop {
        let (status, final_content, final_frags, final_usage) =
            post_stream(client, req, &history, true, deadline, ev).await?;
        // Only the first request's 400 means "no tools here"; a later
        // one (context grown past the limit by fetched pages) is a
        // failure, never an empty answer.
        if status == 400 {
            return Err(rejected_400(&final_content));
        }
        let more = join_calls(&final_frags)
            .into_iter()
            .take(MAX_CALLS_PER_ROUND)
            .collect::<Vec<_>>();
        if more.is_empty() || extra >= EXTRA_FINAL_ROUNDS {
            return Ok((final_content, final_usage.or(usage)));
        }
        extra += 1;
        (ev.on_round_retract)();
        if final_usage.is_some() {
            usage = final_usage;
        }
        run_fetch_batch(&mut history, &final_content, &more, page_fetch, ev).await?;
    }
}

/// A 400 past the first request: the provider's own reason, in the
/// TypeScript engine's words.
fn rejected_400(head: &str) -> AttemptEnd {
    AttemptEnd::Fatal(format!("stream failed (HTTP 400): {head}"))
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
/// last, and every clearer (the 2s timer below, the foreground-return
/// dismiss) targets the same notice instead of stranding it.
const REPLY_NOTIFICATION_ID: i32 = 4201;

/// Activity foreground ground truth (Android): MainActivity reports
/// onResume/onPause through `nativeOnForeground`. Defaults false so
/// desktop — which has no reporter — keeps the window-focus query as
/// its only veto input. Read at completion, beside the ping verdict.
static FOREGROUND: AtomicBool = AtomicBool::new(false);

#[cfg(any(test, target_os = "android"))]
fn set_foreground(active: bool) {
    FOREGROUND.store(active, Ordering::SeqCst);
}

fn app_foreground() -> bool {
    FOREGROUND.load(Ordering::SeqCst)
}

/// Pure ping verdict: an unseen done turn pings only when neither the
/// lifecycle flag nor the window query places the user in the app.
/// Either witness vetoes — a raced ping must never land in front of
/// the user. Pure and unit-tested.
fn should_ping(seen: bool, done: bool, foreground: bool, window_focused: bool) -> bool {
    !seen && done && !(foreground || window_focused)
}

/// Lifecycle report from MainActivity (same convention as the
/// `nativeOnExternalText` entry point).
#[cfg(target_os = "android")]
#[no_mangle]
pub unsafe extern "C" fn Java_studio_ccez_app_MainActivity_nativeOnForeground(
    _env: jni::JNIEnv,
    _this: jni::objects::JObject,
    active: jni::sys::jboolean,
) {
    set_foreground(active != 0);
}

/// Replies channel: the ping must buzz (the finished-while-away thump
/// callers asked back), and on Android buzz means a channel with
/// vibration — the default channel stays silent. Creating an existing
/// channel keeps the user's own settings, so this only sets the
/// first-run default. Android-only: channels don't exist on desktop.
#[cfg(target_os = "android")]
const REPLY_CHANNEL_ID: &str = "replies";

/// The ping is title-only ("Reply ready"): no reply excerpt, no
/// fallback sentence. Owner demand (Sep 2026).
fn notify_ready(app: &AppHandle) {
    use tauri_plugin_notification::NotificationExt;
    #[cfg(target_os = "android")]
    {
        use tauri_plugin_notification::Channel;
        let channel = Channel::builder(REPLY_CHANNEL_ID, "Replies ready")
            .description("One buzzing ping when a reply finishes while away.")
            .vibration(true)
            .build();
        // Best-effort: without the channel the ping below won't fire,
        // but a channel failure must never fail the turn itself.
        let _ = app.notification().create_channel(channel);
    }
    #[cfg_attr(not(target_os = "android"), allow(unused_mut))]
    let mut ping = app
        .notification()
        .builder()
        .id(REPLY_NOTIFICATION_ID)
        .title("Reply ready");
    #[cfg(target_os = "android")]
    {
        ping = ping.channel_id(REPLY_CHANNEL_ID);
    }
    let _ = ping.show();
    // The shade is not storage: a native timer clears the ping after
    // 2s (the page's own timer freezes while backgrounded, which is
    // exactly when this ping exists). Same id the foreground return
    // dismisses, so a revisit clears it even sooner. Android-only:
    // desktop plugin builds (2.x) expose no cancel API, and desktop
    // banners dismiss themselves anyway.
    #[cfg(target_os = "android")]
    {
        let handle = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            std::thread::sleep(Duration::from_secs(2));
            let _ = handle.notification().cancel(vec![REPLY_NOTIFICATION_ID]);
        });
    }
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
        // Tool-round retract rides the same wire event: the page
        // clears its accumulator either way (see run_attempt).
        on_round_retract: Box::new({
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
    // Rolling summary, resolved once per turn (not per attempt):
    // a pending fold costs one short refresh POST before the first
    // attempt; a stop on either side of it stays a clean stop. The
    // refresh rides every finish below — fold work stands even when
    // the turn itself fails, so the retry inherits it.
    let mut refreshed: Option<SummaryRefresh> = None;
    let outcome = match reqwest_client() {
        Ok(client) => {
            if live.stop.load(Ordering::Relaxed) {
                TurnOutcome::Stopped
            } else {
                let (summary, fresh) = resolve_summary(&client, &req).await;
                if let Some(text) = fresh {
                    refreshed = Some(SummaryRefresh {
                        text,
                        through: req.fold_through.clone(),
                    });
                }
                if live.stop.load(Ordering::Relaxed) {
                    TurnOutcome::Stopped
                } else {
                    drive_attempts(
                        &client,
                        &req,
                        &summary,
                        &page_fetch,
                        &BACKOFF_SECS,
                        &mut make_events,
                    )
                    .await
                }
            }
        }
        Err(error) => TurnOutcome::Failed(error),
    };
    match outcome {
        TurnOutcome::Done(content, usage) => {
            finish_turn(&app, &req, &live, Ok((content, usage)), refreshed).await;
        }
        TurnOutcome::Stopped => {
            finish_turn(&app, &req, &live, Err("Reply stopped.".to_string()), refreshed).await;
        }
        TurnOutcome::Failed(error) => {
            finish_turn(&app, &req, &live, Err(error), refreshed).await;
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
    summary: &str,
    page_fetch: &PageFetch,
    backoff: &[u64],
    make_events: &mut (dyn FnMut() -> AttemptEvents + Send),
) -> TurnOutcome {
    let mut attempt: u32 = 0;
    loop {
        attempt += 1;
        let mut ev = make_events();
        match run_attempt(client, req, summary, page_fetch, &mut ev).await {
            Ok((content, usage)) => return TurnOutcome::Done(content, usage),
            Err(AttemptEnd::Stopped) => return TurnOutcome::Stopped,
            Err(AttemptEnd::Fatal(error)) => return TurnOutcome::Failed(error),
            Err(AttemptEnd::Retryable(note)) if attempt >= MAX_ATTEMPTS => {
                // Transport gave up, usually a sleeping radio behind a
                // backgrounded app — never blame the user's network. A
                // server verdict outlives the retries verbatim instead.
                return TurnOutcome::Failed(
                    note.unwrap_or_else(|| "Couldn't finish the reply. Try again.".to_string()),
                )
            }
            Err(AttemptEnd::Retryable(_)) => {
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
    refreshed: Option<SummaryRefresh>,
) {
    let (status, content, error, usage) = match outcome {
        Ok((content, usage)) => ("done".to_string(), content, None, usage),
        Err(error) => ("error".to_string(), String::new(), Some(error), None),
    };
    let (summary, summary_through) = match refreshed {
        Some(refresh) => (Some(refresh.text), Some(refresh.through)),
        None => (None, None),
    };
    let file = TurnFile {
        turn_id: req.turn_id.clone(),
        chat_id: req.chat_id.clone(),
        message_id: req.message_id.clone(),
        status: status.clone(),
        content: content.clone(),
        error: error.clone(),
        usage,
        summary,
        summary_through,
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
    // Instant replace, never a blank gap: the settle above drops
    // Reply coming and a backgrounded done turn pings in the same
    // breath, so the shade swaps one row for the other (owner demand,
    // Sep 2026). A raced ping must still never land in front of the
    // user, so either witness of the user in the app — the Activity
    // lifecycle flag or a focused window — vetoes outright. Both
    // unknown reads as background: the ping is the safe side. A
    // backgrounded user who returns onto the finished reply finds
    // the ping already dismissed by the foreground return.
    if should_ping(
        live.seen.load(Ordering::Relaxed),
        status == "done",
        app_foreground(),
        app.get_webview_window("main")
            .and_then(|window| window.is_focused().ok())
            .unwrap_or(false),
    ) {
        notify_ready(app);
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
            summary: None,
            summary_through: None,
            finished_at: now_secs(),
        },
    )?;
    turn_service_claim(&req.chat_id);
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
/// Android claim: the first live turn starts the foreground service
/// (quiet "Reply coming…" notice, the least Android allows), the
/// last settle stops it. Without this a backgrounded app is killed
/// mid-turn; killed turns auto-resume with dots on return instead.
#[cfg(target_os = "android")]
fn turn_service_claim(chat_id: &str) {
    crate::turn_service::service_claim(chat_id);
}

/// Non-Android builds keep no service: the turn still outlives page
/// stalls wherever the process itself lives (desktop).
#[cfg(not(target_os = "android"))]
fn turn_service_claim(_chat_id: &str) {}

#[cfg(target_os = "android")]
fn turn_service_settle() {
    crate::turn_service::service_settle();
}

#[cfg(not(target_os = "android"))]
fn turn_service_settle() {}

/// Cap for an inbound notice-tap chat id (same flood rule as the
/// desktop deep-link ids).
const MAX_OPEN_CHAT_ID_CHARS: usize = 200;

/// Window event carrying an [`OpenChatPayload`]: the notice tap
/// reuses the desktop deep-link bus and payload shape, so the
/// existing frontend listener handles it on every platform. Live
/// only via the Android JNI entry below, so non-Android builds
/// would warn as dead code without the allow.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
const OPEN_CHAT_EVENT: &str = "deep-link";

/// Frontend payload for [`OPEN_CHAT_EVENT`]: open one chat.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct OpenChatPayload {
    action: String,
    chat_id: Option<String>,
}

static OPEN_CHAT_APP: OnceLock<AppHandle> = OnceLock::new();
static OPEN_CHAT_PENDING: OnceLock<Mutex<Option<OpenChatPayload>>> = OnceLock::new();

fn open_chat_slot() -> &'static Mutex<Option<OpenChatPayload>> {
    OPEN_CHAT_PENDING.get_or_init(|| Mutex::new(None))
}

fn lock_open_chat() -> std::sync::MutexGuard<'static, Option<OpenChatPayload>> {
    open_chat_slot().lock().unwrap_or_else(|e| e.into_inner())
}

/// Capture the handle for notice-tap emits. Called once from
/// `setup`, before any tap can reach the native fn.
pub fn remember_open_chat(app: &AppHandle) {
    let _ = OPEN_CHAT_APP.set(app.clone());
}

/// Notice-tap chat ids are app ids, not free text: trim, drop
/// empties, and cap length. Live only via the Android JNI entry
/// below (plus tests), so non-Android builds would warn as dead
/// code without the allow.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub fn clean_open_chat_id(id: &str) -> Option<String> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.chars().take(MAX_OPEN_CHAT_ID_CHARS).collect())
}

/// Stash + emit an open-chat tap: live listeners get
/// [`OPEN_CHAT_EVENT`], early arrivals wait in the drain slot.
/// Same Android-only liveness as `clean_open_chat_id`.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn deliver_open_chat(app: &AppHandle, id: String) {
    let payload = OpenChatPayload {
        action: "open-chat".to_string(),
        chat_id: Some(id),
    };
    *lock_open_chat() = Some(payload.clone());
    let _ = app.emit(OPEN_CHAT_EVENT, payload);
}

/// Re-emit a parked notice-tap chat, if any. Invoked by the
/// frontend after its deep-link listener is registered; takes
/// (clears) so a tap is never delivered twice.
#[tauri::command]
pub fn turn_drain_pending_chat() -> Result<Option<OpenChatPayload>, String> {
    Ok(lock_open_chat().take())
}

/// Turn-notice tap (content intent on the quiet notice): open the
/// claiming turn's chat. Null/empty taps emit nothing.
#[cfg(target_os = "android")]
#[no_mangle]
pub unsafe extern "C" fn Java_studio_ccez_app_MainActivity_nativeOnOpenChat(
    mut env: jni::JNIEnv,
    _this: jni::objects::JObject,
    chat_id: jni::objects::JObject,
) {
    let incoming: Option<String> = if chat_id.as_raw().is_null() {
        None
    } else {
        env.get_string(&jni::objects::JString::from(chat_id))
            .ok()
            .map(|s| s.to_string_lossy().into_owned())
            .and_then(|s| clean_open_chat_id(&s))
    };
    let Some(id) = incoming else { return };
    match OPEN_CHAT_APP.get() {
        Some(app) => deliver_open_chat(app, id),
        // No handle yet (cold start): park it for the drain above.
        None => {
            *lock_open_chat() = Some(OpenChatPayload {
                action: "open-chat".to_string(),
                chat_id: Some(id),
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn ping_only_for_unseen_backgrounded_done_turns() {
        // The user's case: in the app, unseen, done — no ping.
        assert!(!should_ping(false, true, true, false));
        assert!(!should_ping(false, true, false, true));
        assert!(!should_ping(false, true, true, true));
        // Backgrounded and unseen: ping.
        assert!(should_ping(false, true, false, false));
        // Seen, failed, or interrupted: never.
        assert!(!should_ping(true, true, false, false));
        assert!(!should_ping(false, false, false, false));
    }

    #[test]
    fn foreground_flag_defaults_off() {
        // Desktop has no lifecycle reporter: the window query stays
        // the only veto input there.
        set_foreground(false);
        assert!(!app_foreground());
        set_foreground(true);
        assert!(app_foreground());
        set_foreground(false);
    }

    #[test]
    fn open_chat_id_trims_and_keeps() {
        assert_eq!(clean_open_chat_id("  abc123  "), Some("abc123".into()));
    }

    #[test]
    fn open_chat_id_drops_empties() {
        assert_eq!(clean_open_chat_id(""), None);
        assert_eq!(clean_open_chat_id("   \n  "), None);
    }

    #[test]
    fn open_chat_id_caps_length() {
        let long = "x".repeat(500);
        let out = clean_open_chat_id(&long).expect("non-empty");
        assert_eq!(out.chars().count(), MAX_OPEN_CHAT_ID_CHARS);
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
    fn sse_decoder_keeps_characters_cut_between_chunks() {
        let body = "data: {\"choices\":[{\"delta\":{\"content\":\"日本\"}}]}\n\n".as_bytes();
        let cut = body.iter().position(|b| *b >= 0x80).expect("multibyte") + 1;
        let mut decoder = SseDecoder::default();
        let mut payloads = decoder.push(&body[..cut]);
        payloads.extend(decoder.push(&body[cut..]));
        assert_eq!(payloads.len(), 1);
        assert_eq!(delta_from_payload(&payloads[0]).0, "日本");
    }

    #[test]
    fn sse_decoder_holds_a_crlf_cut_between_chunks() {
        let mut decoder = SseDecoder::default();
        let mut payloads = decoder.push(b"data: line1\r");
        payloads.extend(decoder.push(b"\ndata: line2\r\n\r\n"));
        assert_eq!(payloads, vec!["line1\nline2".to_string()]);
    }

    #[test]
    fn sse_decoder_flushes_an_unclosed_last_event() {
        let mut decoder = SseDecoder::default();
        let mut payloads = decoder.push(b"data: {\"a\":1}\n\ndata: {\"usage\":2}\n");
        payloads.extend(decoder.finish());
        assert_eq!(payloads, vec!["{\"a\":1}".to_string(), "{\"usage\":2}".to_string()]);
        assert!(SseDecoder::default().finish().is_empty());
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
            prior_summary: String::new(),
            fold_text: String::new(),
            fold_through: String::new(),
        };
        let history = vec![wire_message("system", "sys")];
        let stream = stream_body(&req, &history, true);
        assert_eq!(stream["model"], "m");
        assert_eq!(stream["stream"], true);
        assert_eq!(stream["reasoning_effort"], "low");
        assert_eq!(stream["tools"][0]["function"]["name"], "fetch_url");
        // Failed fetches once stalled the turn on a narrated "I'll
        // try another source" with no call behind it (same order as
        // the TypeScript tool definition).
        let description = stream["tools"][0]["function"]["description"]
            .as_str()
            .unwrap_or("");
        assert!(
            description.contains("never write that you will fetch without calling"),
            "tool must order call-don't-narrate"
        );
        assert!(
            description.contains("call again with a different URL instead of stopping"),
            "tool must order retry-on-failure"
        );
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
        sse_tool_body_as("call_1", url)
    }

    fn sse_tool_body_as(id: &str, url: &str) -> Vec<u8> {
        let wire = serde_json::json!({
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": id,
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

    fn json_followup_tool_body(id: &str, url: &str) -> Vec<u8> {
        serde_json::json!({ "choices": [{ "message": { "content": "", "tool_calls": [{
            "id": id,
            "type": "function",
            "function": {
                "name": "fetch_url",
                "arguments": serde_json::json!({ "url": url }).to_string()
            }
        }] } }] })
        .to_string()
        .into_bytes()
    }

    fn json_followup_body() -> Vec<u8> {
        json_followup_body_with("")
    }

    fn json_followup_body_with(content: &str) -> Vec<u8> {
        serde_json::json!({ "choices": [{ "message": { "content": content } }] })
            .to_string()
            .into_bytes()
    }

    struct Recorder {
        tokens: Arc<Mutex<Vec<String>>>,
        fetches: Arc<Mutex<Vec<(bool, String)>>>,
        retries: Arc<Mutex<u32>>,
        retracts: Arc<Mutex<u32>>,
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
            prior_summary: String::new(),
            fold_text: String::new(),
            fold_through: String::new(),
        }
    }

    fn test_events(rec: &Recorder) -> AttemptEvents {
        let tokens = Arc::clone(&rec.tokens);
        let fetches = Arc::clone(&rec.fetches);
        let retries = Arc::clone(&rec.retries);
        let retracts = Arc::clone(&rec.retracts);
        AttemptEvents {
            on_token: Box::new(move |token: String| {
                tokens.lock().unwrap().push(token);
            }),
            on_retry_note: Box::new(move || {
                *retries.lock().unwrap() += 1;
            }),
            on_round_retract: Box::new(move || {
                *retracts.lock().unwrap() += 1;
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
            retracts: Arc::new(Mutex::new(0)),
        };
        let client = reqwest_client().unwrap();
        let req = test_request(port);
        let outcome = tauri::async_runtime::block_on(drive_attempts(
            &client,
            &req,
            "",
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
        // Tool round retracts the streamed prefix (no transport retry).
        assert_eq!(*rec.retracts.lock().unwrap(), 1);
        // Three requests; the follow-up carries the tool result.
        let bodies = bodies.lock().unwrap();
        assert_eq!(bodies.len(), 3);
        assert!(bodies[1].contains("call_1"));
        assert!(bodies[1].contains("page text here"));
    }

    #[test]
    fn drive_caps_tool_rounds_like_the_web_engine() {
        // The model asks for another page every round: three fetch
        // batches, two plain follow-ups, then the streamed answer.
        let bodies = Arc::new(Mutex::new(Vec::new()));
        let port = run_stub(
            vec![
                StubStep::Respond {
                    status: 200,
                    content_type: "text/event-stream",
                    body: sse_tool_body("http://example.test/1"),
                },
                StubStep::Respond {
                    status: 200,
                    content_type: "application/json",
                    body: json_followup_tool_body("call_2", "http://example.test/2"),
                },
                StubStep::Respond {
                    status: 200,
                    content_type: "application/json",
                    body: json_followup_tool_body("call_3", "http://example.test/3"),
                },
                StubStep::Respond {
                    status: 200,
                    content_type: "text/event-stream",
                    body: sse_text_body("the answer"),
                },
            ],
            Arc::clone(&bodies),
        );
        let page_fetch: PageFetch = Arc::new(|url: String| {
            Box::pin(async move { Ok::<String, String>(format!("text of {url}")) })
                as Pin<Box<dyn Future<Output = Result<String, String>> + Send>>
        });
        let rec = Recorder {
            tokens: Arc::new(Mutex::new(Vec::new())),
            fetches: Arc::new(Mutex::new(Vec::new())),
            retries: Arc::new(Mutex::new(0)),
            retracts: Arc::new(Mutex::new(0)),
        };
        let client = reqwest_client().unwrap();
        let req = test_request(port);
        let outcome = tauri::async_runtime::block_on(drive_attempts(
            &client,
            &req,
            "",
            &page_fetch,
            &[0],
            &mut || test_events(&rec),
        ));
        match outcome {
            TurnOutcome::Done(content, _) => assert_eq!(content, "the answer"),
            other => panic!("expected done, got {other:?}"),
        }
        let started = rec.fetches.lock().unwrap().iter().filter(|(start, _)| *start).count();
        assert_eq!(started, 3);
        let bodies = bodies.lock().unwrap();
        assert_eq!(bodies.len(), 4);
        assert!(bodies[3].contains("text of http://example.test/3"));
    }

    #[test]
    fn drive_reports_a_late_400_instead_of_an_empty_answer() {
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
                    status: 400,
                    content_type: "application/json",
                    body: b"context length exceeded".to_vec(),
                },
            ],
            Arc::clone(&bodies),
        );
        let page_fetch: PageFetch = Arc::new(|_url: String| {
            Box::pin(async move { Ok::<String, String>("a long page".to_string()) })
                as Pin<Box<dyn Future<Output = Result<String, String>> + Send>>
        });
        let rec = Recorder {
            tokens: Arc::new(Mutex::new(Vec::new())),
            fetches: Arc::new(Mutex::new(Vec::new())),
            retries: Arc::new(Mutex::new(0)),
            retracts: Arc::new(Mutex::new(0)),
        };
        let client = reqwest_client().unwrap();
        let req = test_request(port);
        let outcome = tauri::async_runtime::block_on(drive_attempts(
            &client,
            &req,
            "",
            &page_fetch,
            &[0],
            &mut || test_events(&rec),
        ));
        match outcome {
            TurnOutcome::Failed(error) => {
                assert!(error.contains("HTTP 400"), "{error}");
                assert!(error.contains("context length exceeded"), "{error}");
            }
            other => panic!("expected failed, got {other:?}"),
        }
    }

    #[test]
    fn drive_reasks_without_tools_when_every_call_is_unusable() {
        let bodies = Arc::new(Mutex::new(Vec::new()));
        let port = run_stub(
            vec![
                StubStep::Respond {
                    status: 200,
                    content_type: "text/event-stream",
                    body: sse_tool_body(""),
                },
                StubStep::Respond {
                    status: 200,
                    content_type: "text/event-stream",
                    body: sse_text_body("plain answer"),
                },
            ],
            Arc::clone(&bodies),
        );
        let page_fetch: PageFetch = Arc::new(|_url: String| {
            Box::pin(async move { Ok::<String, String>(String::new()) })
                as Pin<Box<dyn Future<Output = Result<String, String>> + Send>>
        });
        let rec = Recorder {
            tokens: Arc::new(Mutex::new(Vec::new())),
            fetches: Arc::new(Mutex::new(Vec::new())),
            retries: Arc::new(Mutex::new(0)),
            retracts: Arc::new(Mutex::new(0)),
        };
        let client = reqwest_client().unwrap();
        let req = test_request(port);
        let outcome = tauri::async_runtime::block_on(drive_attempts(
            &client,
            &req,
            "",
            &page_fetch,
            &[0],
            &mut || test_events(&rec),
        ));
        match outcome {
            TurnOutcome::Done(content, _) => assert_eq!(content, "plain answer"),
            other => panic!("expected done, got {other:?}"),
        }
        assert!(rec.fetches.lock().unwrap().is_empty());
        let bodies = bodies.lock().unwrap();
        assert_eq!(bodies.len(), 2);
        assert!(bodies[0].contains("\"tools\""));
        assert!(!bodies[1].contains("\"tools\""));
    }

    #[test]
    fn drive_lands_the_followup_answer_instead_of_reasking() {
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
                    body: json_followup_body_with("answered from the page"),
                },
            ],
            Arc::clone(&bodies),
        );
        let page_fetch: PageFetch = Arc::new(|_url: String| {
            Box::pin(async move { Ok::<String, String>("page text here".to_string()) })
                as Pin<Box<dyn Future<Output = Result<String, String>> + Send>>
        });
        let rec = Recorder {
            tokens: Arc::new(Mutex::new(Vec::new())),
            fetches: Arc::new(Mutex::new(Vec::new())),
            retries: Arc::new(Mutex::new(0)),
            retracts: Arc::new(Mutex::new(0)),
        };
        let client = reqwest_client().unwrap();
        let req = test_request(port);
        let outcome = tauri::async_runtime::block_on(drive_attempts(
            &client,
            &req,
            "",
            &page_fetch,
            &[0],
            &mut || test_events(&rec),
        ));
        match outcome {
            TurnOutcome::Done(content, _) => {
                assert_eq!(content, "answered from the page")
            }
            other => panic!("expected done, got {other:?}"),
        }
        // Two requests, not three: the follow-up's text is emitted as
        // the reply instead of discarded for a regenerating re-ask.
        assert_eq!(bodies.lock().unwrap().len(), 2);
        assert_eq!(
            *rec.tokens.lock().unwrap(),
            vec!["answered from the page"]
        );
    }

    #[test]
    fn drive_runs_extra_rounds_when_final_keeps_calling_fetch() {
        let bodies = Arc::new(Mutex::new(Vec::new()));
        let port = run_stub(
            vec![
                StubStep::Respond {
                    status: 200,
                    content_type: "text/event-stream",
                    body: sse_tool_body("http://a.test/"),
                },
                StubStep::Respond {
                    status: 200,
                    content_type: "application/json",
                    body: json_followup_body(),
                },
                StubStep::Respond {
                    status: 200,
                    content_type: "text/event-stream",
                    body: sse_tool_body_as("call_2", "http://b.test/"),
                },
                StubStep::Respond {
                    status: 200,
                    content_type: "text/event-stream",
                    body: sse_text_body("done after retry"),
                },
            ],
            Arc::clone(&bodies),
        );
        let fetched = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&fetched);
        let page_fetch: PageFetch = Arc::new(move |url: String| {
            let seen = Arc::clone(&seen);
            Box::pin(async move {
                seen.lock().unwrap().push(url);
                Ok::<String, String>("page text here".to_string())
            })
                as Pin<Box<dyn Future<Output = Result<String, String>> + Send>>
        });
        let rec = Recorder {
            tokens: Arc::new(Mutex::new(Vec::new())),
            fetches: Arc::new(Mutex::new(Vec::new())),
            retries: Arc::new(Mutex::new(0)),
            retracts: Arc::new(Mutex::new(0)),
        };
        let client = reqwest_client().unwrap();
        let req = test_request(port);
        let outcome = tauri::async_runtime::block_on(drive_attempts(
            &client,
            &req,
            "",
            &page_fetch,
            &[0],
            &mut || test_events(&rec),
        ));
        match outcome {
            TurnOutcome::Done(content, _) => assert_eq!(content, "done after retry"),
            other => panic!("expected done, got {other:?}"),
        }
        assert_eq!(
            *fetched.lock().unwrap(),
            vec!["http://a.test/".to_string(), "http://b.test/".to_string()]
        );
        assert_eq!(*rec.tokens.lock().unwrap(), vec!["done after retry"]);
        assert_eq!(*rec.retracts.lock().unwrap(), 2);
        let bodies = bodies.lock().unwrap();
        assert_eq!(bodies.len(), 4);
        // Finals stream WITH tools, so a last retry can act.
        assert!(bodies[2].contains("fetch_url"), "final must offer tools");
        assert!(bodies[3].contains("fetch_url"), "final must offer tools");
    }

    #[test]
    fn resolve_summary_refreshes_a_pending_fold() {
        let bodies = Arc::new(Mutex::new(Vec::new()));
        let port = run_stub(
            vec![StubStep::Respond {
                status: 200,
                content_type: "application/json",
                body: json_followup_body_with("fresh summary"),
            }],
            Arc::clone(&bodies),
        );
        let client = reqwest_client().unwrap();
        let mut req = test_request(port);
        req.prior_summary = "old stuff".to_string();
        req.fold_text = "User: hi".to_string();
        req.fold_through = "m1".to_string();
        let (to_use, refreshed) =
            tauri::async_runtime::block_on(resolve_summary(&client, &req));
        assert_eq!(to_use, "fresh summary");
        assert_eq!(refreshed, Some("fresh summary".to_string()));
        let bodies = bodies.lock().unwrap();
        assert_eq!(bodies.len(), 1);
        // One short tools-off POST merging prior plus fold.
        assert!(bodies[0].contains("Third person"), "refresh instruction");
        assert!(bodies[0].contains("Previous summary"), "prior carried");
        assert!(bodies[0].contains("old stuff"), "prior carried");
        assert!(bodies[0].contains("User: hi"), "fold carried");
        assert!(!bodies[0].contains("fetch_url"), "refresh takes no tools");
    }

    #[test]
    fn resolve_summary_stands_pat_without_a_fold() {
        // No fold pending means no POST at all (any port: unused).
        let client = reqwest_client().unwrap();
        let mut req = test_request(1);
        req.prior_summary = "old stuff".to_string();
        let (to_use, refreshed) =
            tauri::async_runtime::block_on(resolve_summary(&client, &req));
        assert_eq!(to_use, "old stuff");
        assert_eq!(refreshed, None);
    }

    #[test]
    fn resolve_summary_falls_back_to_prior_on_failure() {
        let bodies = Arc::new(Mutex::new(Vec::new()));
        let port = run_stub(
            vec![StubStep::Respond {
                status: 500,
                content_type: "application/json",
                body: b"{}".to_vec(),
            }],
            Arc::clone(&bodies),
        );
        let client = reqwest_client().unwrap();
        let mut req = test_request(port);
        req.prior_summary = "old stuff".to_string();
        req.fold_text = "User: hi".to_string();
        let (to_use, refreshed) =
            tauri::async_runtime::block_on(resolve_summary(&client, &req));
        // The turn still runs windowed on the prior text.
        assert_eq!(to_use, "old stuff");
        assert_eq!(refreshed, None);
    }

    #[test]
    fn drive_sends_the_resolved_summary_ahead_of_history() {
        let bodies = Arc::new(Mutex::new(Vec::new()));
        let port = run_stub(
            vec![StubStep::Respond {
                status: 200,
                content_type: "text/event-stream",
                body: sse_text_body("hi there"),
            }],
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
            retracts: Arc::new(Mutex::new(0)),
        };
        let client = reqwest_client().unwrap();
        let req = test_request(port);
        let outcome = tauri::async_runtime::block_on(drive_attempts(
            &client,
            &req,
            "rolled up",
            &page_fetch,
            &[0],
            &mut || test_events(&rec),
        ));
        match outcome {
            TurnOutcome::Done(content, _) => assert_eq!(content, "hi there"),
            other => panic!("expected done, got {other:?}"),
        }
        let bodies = bodies.lock().unwrap();
        assert_eq!(bodies.len(), 1);
        // Second system message: after the system prompt, before turns.
        let sys = bodies[0].find("sys").unwrap_or(usize::MAX);
        let marker = bodies[0]
            .find("summarized for context")
            .unwrap_or(usize::MAX);
        let turn = bodies[0].find("\"content\":\"hi\"").unwrap_or(usize::MAX);
        assert!(sys < marker && marker < turn, "summary sits second");
        assert!(bodies[0].contains("rolled up"), "summary text sent");
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
            retracts: Arc::new(Mutex::new(0)),
        };
        let client = reqwest_client().unwrap();
        let req = test_request(port);
        let outcome = tauri::async_runtime::block_on(drive_attempts(
            &client,
            &req,
            "",
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

    #[test]
    fn retryable_http_status_covers_limits_and_overloads() {
        for status in [429, 500, 502, 503, 529] {
            assert!(retryable_http_status(status), "{status} should retry");
        }
        for status in [200, 400, 401, 403, 404] {
            assert!(!retryable_http_status(status), "{status} should fail");
        }
    }

    #[test]
    fn drive_retries_a_503_then_finishes() {
        let bodies = Arc::new(Mutex::new(Vec::new()));
        let port = run_stub(
            vec![
                StubStep::Respond {
                    status: 503,
                    content_type: "application/json",
                    body: br#"{"error":{"message":"overloaded"}}"#.to_vec(),
                },
                StubStep::Respond {
                    status: 200,
                    content_type: "text/event-stream",
                    body: sse_text_body("recovered"),
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
            retracts: Arc::new(Mutex::new(0)),
        };
        let client = reqwest_client().unwrap();
        let req = test_request(port);
        let outcome = tauri::async_runtime::block_on(drive_attempts(
            &client,
            &req,
            "",
            &page_fetch,
            &[0],
            &mut || test_events(&rec),
        ));
        match outcome {
            TurnOutcome::Done(content, _) => assert_eq!(content, "recovered"),
            other => panic!("expected done, got {other:?}"),
        }
        assert_eq!(*rec.retries.lock().unwrap(), 1);
        assert_eq!(bodies.lock().unwrap().len(), 2);
    }

    #[test]
    fn drive_surfaces_the_last_http_error_when_overloaded_persists() {
        let bodies = Arc::new(Mutex::new(Vec::new()));
        let port = run_stub(
            vec![
                StubStep::Respond {
                    status: 503,
                    content_type: "application/json",
                    body: br#"{"error":{"message":"overloaded"}}"#.to_vec(),
                },
                StubStep::Respond {
                    status: 503,
                    content_type: "application/json",
                    body: br#"{"error":{"message":"overloaded"}}"#.to_vec(),
                },
                StubStep::Respond {
                    status: 503,
                    content_type: "application/json",
                    body: br#"{"error":{"message":"overloaded"}}"#.to_vec(),
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
            retracts: Arc::new(Mutex::new(0)),
        };
        let client = reqwest_client().unwrap();
        let req = test_request(port);
        let outcome = tauri::async_runtime::block_on(drive_attempts(
            &client,
            &req,
            "",
            &page_fetch,
            &[0],
            &mut || test_events(&rec),
        ));
        match outcome {
            TurnOutcome::Failed(error) => assert!(
                error.contains("503"),
                "exhausted overload should name the status, got: {error}"
            ),
            other => panic!("expected failed, got {other:?}"),
        }
        assert_eq!(*rec.retries.lock().unwrap(), 2);
        assert_eq!(bodies.lock().unwrap().len(), 3);
    }
}
