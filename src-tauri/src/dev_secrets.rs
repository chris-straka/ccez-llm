//! Dev-build key store: debug builds keep API keys in a gitignored,
//! owner-only file (`src-tauri/.dev-secrets.json`) instead of the macOS
//! Keychain. A self-signed dev binary is re-identified by content hash
//! on every Rust rebuild, so the Keychain asked for the login password
//! after each one; the file never asks. Release builds and Android
//! never compile this path (see `keychain_*` in lib.rs).
//!
//! The file maps account → secret, or → null for a deleted key. The
//! null matters: a key missing from the file falls back to one last
//! Keychain read (the migration), so a deletion must be remembered or
//! the old Keychain copy would come back.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub type Store = BTreeMap<String, Option<String>>;

/// Repo-local and gitignored (owner's call, 2026-10-01).
pub fn store_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".dev-secrets.json")
}

pub fn load(path: &Path) -> Store {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// What the file says about `account`: `Some(Some(secret))` stored,
/// `Some(None)` deleted, `None` unknown (fall back to the Keychain).
pub fn lookup(path: &Path, account: &str) -> Option<Option<String>> {
    load(path).get(account).cloned()
}

/// Record a secret (`None` = deleted). Writes a temp file then renames,
/// owner-only (0600) on Unix.
pub fn record(path: &Path, account: &str, secret: Option<String>) -> Result<(), String> {
    let mut store = load(path);
    store.insert(account.to_string(), secret);
    let raw = serde_json::to_string_pretty(&store).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    write_private(&tmp, raw.as_bytes())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[cfg(unix)]
fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
        .map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())
}

#[cfg(not(unix))]
fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{load, lookup, record};

    fn temp_store(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("ccez-dev-secrets-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(".dev-secrets.json");
        let _ = std::fs::remove_file(&path);
        path
    }

    #[test]
    fn records_reads_and_remembers_deletions() {
        let path = temp_store("rw");
        assert_eq!(lookup(&path, "providers"), None);
        record(&path, "providers", Some("{\"muse\":\"k\"}".into())).unwrap();
        assert_eq!(
            lookup(&path, "providers"),
            Some(Some("{\"muse\":\"k\"}".into()))
        );
        record(&path, "provider:muse", None).unwrap();
        assert_eq!(lookup(&path, "provider:muse"), Some(None));
        assert_eq!(load(&path).len(), 2);
    }

    #[test]
    fn junk_files_read_as_empty() {
        let path = temp_store("junk");
        std::fs::write(&path, "not json").unwrap();
        assert_eq!(lookup(&path, "providers"), None);
    }

    #[cfg(unix)]
    #[test]
    fn writes_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let path = temp_store("mode");
        record(&path, "providers", Some("k".into())).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
}
