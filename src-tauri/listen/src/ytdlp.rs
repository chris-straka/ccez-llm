//! yt-dlp as a child process: locate it, run it with a deadline.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Finder apps on macOS get launchd's bare PATH, so the usual install
/// spots are checked after it.
const EXTRA_DIRS: &[&str] = &[
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "~/.local/bin",
    "~/bin",
];

fn expand(dir: &str) -> PathBuf {
    match dir.strip_prefix("~/") {
        Some(rest) => std::env::var_os("HOME")
            .map(|h| PathBuf::from(h).join(rest))
            .unwrap_or_else(|| PathBuf::from(dir)),
        None => PathBuf::from(dir),
    }
}

/// Path to an executable named `name`, from `$CCEZ_LISTEN_<NAME>`,
/// PATH, or the usual install spots.
pub fn find_tool(name: &str) -> Option<PathBuf> {
    let env_key = format!(
        "CCEZ_LISTEN_{}",
        name.to_ascii_uppercase().replace('-', "_")
    );
    if let Some(p) = std::env::var_os(env_key).map(PathBuf::from) {
        if p.is_file() {
            return Some(p);
        }
    }
    let path_dirs = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
        .unwrap_or_default();
    path_dirs
        .into_iter()
        .chain(EXTRA_DIRS.iter().map(|d| expand(d)))
        .map(|d| d.join(name))
        .find(|p| p.is_file())
}

#[derive(Debug)]
pub enum RunError {
    /// yt-dlp isn't installed (the app says how to get it).
    Missing,
    Timeout,
    Failed(String),
}

impl std::fmt::Display for RunError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RunError::Missing => write!(f, "listen-no-ytdlp"),
            RunError::Timeout => write!(f, "listen-timeout"),
            RunError::Failed(msg) => write!(f, "listen-failed: {msg}"),
        }
    }
}

/// Run yt-dlp with `args`; stdout on success. A run past `deadline`
/// is killed. Stderr's last line becomes the error.
pub fn run(args: &[&str], cwd: Option<&Path>, deadline: Duration) -> Result<Vec<u8>, RunError> {
    let bin = find_tool("yt-dlp").ok_or(RunError::Missing)?;
    let mut cmd = Command::new(bin);
    // ffmpeg sits next to yt-dlp in the same spots; give the child the
    // extended PATH so it finds it for HLS or merges.
    let extra = EXTRA_DIRS.iter().map(|d| expand(d));
    let path = std::env::var_os("PATH")
        .map(|p| {
            std::env::split_paths(&p)
                .chain(extra.clone())
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| extra.collect());
    if let Ok(joined) = std::env::join_paths(path) {
        cmd.env("PATH", joined);
    }
    cmd.args(["--no-warnings", "--no-progress", "--ignore-config"])
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    let mut child = cmd.spawn().map_err(|e| RunError::Failed(e.to_string()))?;
    let mut stdout = child.stdout.take().expect("piped");
    let mut stderr = child.stderr.take().expect("piped");
    let out_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        buf
    });
    let err_reader = std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = stderr.read_to_string(&mut buf);
        buf
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() > deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(RunError::Timeout);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(e) => return Err(RunError::Failed(e.to_string())),
        }
    };
    let out = out_reader.join().unwrap_or_default();
    let err = err_reader.join().unwrap_or_default();
    if status.success() {
        Ok(out)
    } else {
        let line = err
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("yt-dlp failed")
            .trim()
            .to_string();
        Err(RunError::Failed(line))
    }
}
