//! The agent API (owner, 2026-11-10: "it should have an API for you to
//! interface with"): `scripts/llm.ts` asks the running app to answer a
//! question or annotate a word and prints what comes back, so an agent can
//! check the real engine without clicking around its window.
//!
//! A Unix socket in the app's data folder, `agent.sock`, open to the
//! owner's account only (mode 0600): the same reach as the data files
//! themselves, unlike a TCP port any local program could knock on. Each
//! connection sends one JSON line `{"cmd", "args"}`; the window hears it as
//! an `agent-request` event, does the work (no chat is touched: `ask` and
//! `annotate` answer off the record), and streams JSON lines back through
//! `agent_reply` until one carries `"done": true`.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Replies waiting to go out, by request id.
static PENDING: LazyLock<Mutex<HashMap<u64, Sender<String>>>> = LazyLock::new(Default::default);
static NEXT: AtomicU64 = AtomicU64::new(1);
/// A request the window never starts answering is given up after this.
const FIRST: Duration = Duration::from_secs(15);
/// The longest wait between two lines of an answer (a slow model).
const BETWEEN: Duration = Duration::from_secs(180);

/// Opens the socket and serves it on a thread of its own.
pub fn start<R: Runtime>(app: &AppHandle<R>) {
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("agent.sock");
    let _ = std::fs::remove_file(&path);
    let Ok(listener) = UnixListener::bind(&path) else {
        return;
    };
    let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    let app = app.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let app = app.clone();
            std::thread::spawn(move || serve(&app, stream));
        }
    });
}

fn serve<R: Runtime>(app: &AppHandle<R>, stream: UnixStream) {
    let mut out = match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    };
    let mut line = String::new();
    if BufReader::new(stream).read_line(&mut line).is_err() {
        return;
    }
    let Ok(req) = serde_json::from_str::<Value>(&line) else {
        let _ = writeln!(out, "{{\"done\":true,\"error\":\"not JSON\"}}");
        return;
    };
    let id = NEXT.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = channel();
    PENDING.lock().unwrap().insert(id, tx);
    let ask = serde_json::json!({"id": id, "cmd": req["cmd"], "args": req["args"]});
    if app.emit("agent-request", ask).is_err() {
        let _ = writeln!(
            out,
            "{{\"done\":true,\"error\":\"the window isn't listening\"}}"
        );
    } else {
        let mut wait = FIRST;
        loop {
            match rx.recv_timeout(wait) {
                Ok(reply) => {
                    let done = serde_json::from_str::<Value>(&reply)
                        .map(|v| v["done"] == true)
                        .unwrap_or(false);
                    if writeln!(out, "{reply}").is_err() || done {
                        break;
                    }
                    wait = BETWEEN;
                }
                Err(_) => {
                    let _ = writeln!(
                        out,
                        "{{\"done\":true,\"error\":\"no answer from the window\"}}"
                    );
                    break;
                }
            }
        }
    }
    PENDING.lock().unwrap().remove(&id);
}

/// A line of the window's answer to request `id` (JSON; `"done": true` ends it).
#[tauri::command]
pub fn agent_reply(id: u64, line: String) {
    if let Some(tx) = PENDING.lock().unwrap().get(&id) {
        let _ = tx.send(line);
    }
}
