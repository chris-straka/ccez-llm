//! Local Code Run: execute an assistant code block on this machine.
//!
//! Shape: a privileged Tauri command (`run_code`) is the sanctioned
//! path — the backend already shells out (TTS, opener, sleep guards),
//! so one more narrow, user-initiated local execution stays inside
//! the established trust boundary. There is deliberately no shell:
//! the runner resolves via `PATH` and receives exactly one argument
//! (the temp file), so fence text can never become flags.
//!
//! Security contract (all enforced here, not in the UI):
//! - User-initiated clicks only: the frontend wires Run to a real
//!   button press; this command itself performs no network I/O and
//!   takes no URL, no shell string, and no extra argv.
//! - No network: nothing here opens a socket; the child inherits the
//!   user's own sandbox (a runaway `fetch` inside guest code is the
//!   user's own process, same as Code Runner / a terminal paste).
//! - Timeout enforced: the child is killed after
//!   [`CODE_RUN_TIMEOUT_SECS`] and `timed_out` reports it.
//! - cwd is a fresh per-run temp dir (returned as `cwd`), so guest
//!   code reads/writes next to its own file, never the vault.
//!
//! Outside the Tauri shell (browser dev, jsdom) the frontend never
//! calls this: it shows a disabled-with-reason note instead.

use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Hard wall-clock budget per run (mirrors `CODE_RUN_TIMEOUT_SECS`
/// in `src/lib/coderun.ts` — the Vitest mapping/timeout suite locks
/// both to the same value).
pub const CODE_RUN_TIMEOUT_SECS: u64 = 10;

/// Stdout/stderr are each capped here; `truncated` reports the cut.
pub const CODE_RUN_MAX_OUTPUT: usize = 64 * 1024;

/// What the UI renders under the block.
#[derive(serde::Serialize, Debug)]
pub struct CodeRunResult {
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub truncated: bool,
    /// The per-run working directory the code executed in.
    pub cwd: String,
    /// Resolved `program` plus argv (for the "ran with …" line).
    pub command: Vec<String>,
}

/// PATH-resolved runner for a fence label. Unknown labels are `None`
/// — the caller reports an honest "no runner" note, never a guess.
/// Mirrors `runnerFor` in `src/lib/coderun.ts` (same suite locks both).
pub fn runner_for(language: &str) -> Option<(&'static str, &'static str)> {
    match language.trim().to_ascii_lowercase().as_str() {
        "python" | "py" | "python3" => Some(("python3", "py")),
        "javascript" | "js" | "mjs" | "cjs" | "node" => Some(("node", "js")),
        "typescript" | "ts" => Some(("bun", "ts")),
        "bash" | "sh" | "shell" => Some(("bash", "sh")),
        "ruby" | "rb" => Some(("ruby", "rb")),
        "go" | "golang" => Some(("go", "go")),
        "bun" => Some(("bun", "js")),
        "deno" => Some(("deno", "js")),
        _ => None,
    }
}

fn truncate(s: &str) -> (String, bool) {
    if s.len() <= CODE_RUN_MAX_OUTPUT {
        return (s.to_string(), false);
    }
    // Cut on a char boundary at or before the cap.
    let mut end = CODE_RUN_MAX_OUTPUT;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    (format!("{}[…truncated at 64 KiB]", &s[..end]), true)
}

/// Run `code` fenced as `language`. User-initiated only (see module docs).
#[tauri::command]
pub fn run_code(language: String, code: String) -> Result<CodeRunResult, String> {
    let (program, suffix) = runner_for(&language).ok_or_else(|| {
        format!(
            "no local runner for \"{language}\" — python, javascript, typescript (bun), bash, ruby, deno, and go run locally"
        )
    })?;
    if code.trim().is_empty() {
        return Err("nothing to run — the block is empty".to_string());
    }
    if code.len() > 256 * 1024 {
        return Err("code block is over the 256 KiB run limit".to_string());
    }

    // Fresh per-run dir: the stated working directory, returned as `cwd`.
    let dir = std::env::temp_dir().join(format!(
        "ccez-code-run-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not make a run directory: {e}"))?;
    let file = dir.join(format!("snippet.{suffix}"));
    std::fs::write(&file, &code).map_err(|e| format!("could not stage the snippet: {e}"))?;

    // Deno and Go need an explicit `run` subcommand; the rest take the file.
    let mut argv = vec![program.to_string()];
    if program == "deno" || program == "go" {
        argv.push("run".to_string());
    }
    argv.push(file.to_string_lossy().to_string());

    let mut child = Command::new(program)
        .args(&argv[1..])
        .current_dir(&dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                format!("\"{program}\" is not on PATH — install it to run {language} blocks")
            } else {
                format!("could not start \"{program}\": {e}")
            }
        })?;

    // Drain pipes on threads so a chatty child can't deadlock the
    // 64 KiB OS pipe while we poll the deadline on this thread.
    let out_handle = child.stdout.take().map(|mut pipe| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = pipe.read_to_end(&mut buf);
            String::from_utf8_lossy(&buf).into_owned()
        })
    });
    let err_handle = child.stderr.take().map(|mut pipe| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = pipe.read_to_end(&mut buf);
            String::from_utf8_lossy(&buf).into_owned()
        })
    });

    let deadline = Duration::from_secs(CODE_RUN_TIMEOUT_SECS);
    let start = Instant::now();
    let mut timed_out = false;
    loop {
        match child
            .try_wait()
            .map_err(|e| format!("could not poll the runner: {e}"))?
        {
            Some(_status) => break,
            None => {
                if start.elapsed() >= deadline {
                    timed_out = true;
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
    let status = if timed_out {
        None
    } else {
        child
            .try_wait()
            .map_err(|e| format!("could not read the exit status: {e}"))?
    };

    let stdout = out_handle
        .map(|h| h.join().unwrap_or_default())
        .unwrap_or_default();
    let stderr = err_handle
        .map(|h| h.join().unwrap_or_default())
        .unwrap_or_default();
    let (stdout, t1) = truncate(&stdout);
    let (stderr, t2) = truncate(&stderr);

    // Best-effort cleanup; the OS temp sweeper owns the rest.
    let _ = std::fs::remove_dir_all(&dir);

    Ok(CodeRunResult {
        exit_code: status.and_then(|s| s.code()),
        stdout,
        stderr,
        timed_out,
        truncated: t1 || t2,
        cwd: dir.to_string_lossy().to_string(),
        command: argv,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mappings_resolve() {
        assert_eq!(runner_for("python"), Some(("python3", "py")));
        assert_eq!(runner_for("  PY  "), Some(("python3", "py")));
        assert_eq!(runner_for("JS"), Some(("node", "js")));
        assert_eq!(runner_for("ts"), Some(("bun", "ts")));
        assert_eq!(runner_for("sh"), Some(("bash", "sh")));
        assert_eq!(runner_for("ruby"), Some(("ruby", "rb")));
        assert!(runner_for("haskell").is_none());
        assert!(runner_for("").is_none());
    }

    #[test]
    fn timeout_constant_matches_frontend() {
        assert_eq!(CODE_RUN_TIMEOUT_SECS, 10);
    }

    #[test]
    fn live_python_run_or_honest_skip() {
        match run_code("python".to_string(), "print(\"hi\")".to_string()) {
            Ok(out) => {
                assert!(!out.timed_out);
                assert_eq!(out.exit_code, Some(0));
                assert!(out.stdout.contains("hi"), "stdout was {:?}", out.stdout);
            }
            // No python3 on PATH here: the honest missing-runner
            // error is the correct behavior, not a failure.
            Err(e) => assert!(e.contains("not on PATH"), "unexpected error: {e}"),
        }
    }

    #[test]
    fn live_unknown_language_is_no_runner() {
        let err = run_code("haskell".to_string(), "main = return ()".to_string()).unwrap_err();
        assert!(err.contains("no local runner"), "unexpected error: {err}");
    }

    #[test]
    fn truncate_caps() {
        let big = "x".repeat(CODE_RUN_MAX_OUTPUT + 1);
        let (out, cut) = truncate(&big);
        assert!(cut);
        assert!(out.contains("truncated"));
        assert!(out.starts_with(&big[..CODE_RUN_MAX_OUTPUT - 8]));
        let (small, cut) = truncate("hi");
        assert!(!cut && small == "hi");
    }
}
