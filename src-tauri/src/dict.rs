//! Dictionary packs for word cards (scripts/dict-pack.ts writes them):
//! one file per language, downloaded from this repo's `dictionaries`
//! release the first time a word in that language is annotated, then
//! read from disk. `dict_install` fetches the manifest, streams the
//! gzipped pack with `dict-progress` events, checks its SHA-256,
//! unpacks it and swaps it in; `dict_lookup` binary-searches the
//! sorted forms (kept in memory) and reads the matching entries off
//! disk. The web build has no backend and stays AI-only.

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

/// The release the packs and their manifest are attached to.
const RELEASE_URL: &str = "https://github.com/chris-straka/ccez-llm/releases/download/dictionaries";
const MAGIC: &[u8; 8] = b"CCEZDIC1";
/// Progress event while a pack downloads.
pub const PROGRESS_EVENT: &str = "dict-progress";

/// An open pack: offsets and sorted keys in memory, values and
/// entries read from the file on demand.
struct Pack {
    file: Mutex<File>,
    tags: Vec<String>,
    key_offs: Vec<u32>,
    val_offs: Vec<u32>,
    ent_offs: Vec<u32>,
    keys: Vec<u8>,
    vals_at: u64,
    ents_at: u64,
}

/// One dictionary hit for a form: its grammar tags, the entry
/// (headword, part of speech, gender, reading, senses) as stored, and
/// where the form splits when the pack knows: the lengths in
/// characters of its prefix, stem and number piece (the ending is the
/// rest). Packs before splits leave it out.
#[derive(Debug, Serialize, PartialEq)]
pub struct Hit {
    pub tags: String,
    pub entry: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub split: Option<[u8; 3]>,
}

/// A stem length of this value marks a form whose split isn't known.
const NO_SPLIT: u8 = 0xff;

fn read_u32(r: &mut impl Read) -> std::io::Result<u32> {
    let mut b = [0u8; 4];
    r.read_exact(&mut b)?;
    Ok(u32::from_le_bytes(b))
}

fn read_u32s(r: &mut impl Read, n: usize) -> std::io::Result<Vec<u32>> {
    let mut bytes = vec![0u8; n * 4];
    r.read_exact(&mut bytes)?;
    Ok(bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|c| u32::from_le_bytes(*c))
        .collect())
}

impl Pack {
    fn open(path: &Path) -> Result<Pack, String> {
        let mut file = File::open(path).map_err(|e| e.to_string())?;
        let mut magic = [0u8; 8];
        file.read_exact(&mut magic).map_err(|e| e.to_string())?;
        if &magic != MAGIC {
            return Err("not a dictionary pack".into());
        }
        let head_len = read_u32(&mut file).map_err(|e| e.to_string())? as usize;
        let mut head = vec![0u8; head_len];
        file.read_exact(&mut head).map_err(|e| e.to_string())?;
        let header: serde_json::Value = serde_json::from_slice(&head).map_err(|e| e.to_string())?;
        let tags = header["tags"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|t| t.as_str().unwrap_or("").to_string())
                    .collect()
            })
            .unwrap_or_default();
        let n_keys = read_u32(&mut file).map_err(|e| e.to_string())? as usize;
        let n_entries = read_u32(&mut file).map_err(|e| e.to_string())? as usize;
        let key_offs = read_u32s(&mut file, n_keys + 1).map_err(|e| e.to_string())?;
        let val_offs = read_u32s(&mut file, n_keys + 1).map_err(|e| e.to_string())?;
        let ent_offs = read_u32s(&mut file, n_entries + 1).map_err(|e| e.to_string())?;
        let mut keys = vec![0u8; key_offs[n_keys] as usize];
        file.read_exact(&mut keys).map_err(|e| e.to_string())?;
        let vals_at = file.stream_position().map_err(|e| e.to_string())?;
        let ents_at = vals_at + u64::from(val_offs[n_keys]);
        Ok(Pack {
            file: Mutex::new(file),
            tags,
            key_offs,
            val_offs,
            ent_offs,
            keys,
            vals_at,
            ents_at,
        })
    }

    fn key(&self, i: usize) -> &[u8] {
        &self.keys[self.key_offs[i] as usize..self.key_offs[i + 1] as usize]
    }

    fn read_at(&self, at: u64, len: usize) -> Result<Vec<u8>, String> {
        let mut file = self
            .file
            .lock()
            .map_err(|_| "pack lock poisoned".to_string())?;
        file.seek(SeekFrom::Start(at)).map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; len];
        file.read_exact(&mut buf).map_err(|e| e.to_string())?;
        Ok(buf)
    }

    fn lookup(&self, form: &str) -> Result<Vec<Hit>, String> {
        let target = fold(form);
        let (mut lo, mut hi) = (0usize, self.key_offs.len() - 1);
        let mut found = None;
        while lo < hi {
            let mid = (lo + hi) / 2;
            match self.key(mid).cmp(target.as_bytes()) {
                std::cmp::Ordering::Equal => {
                    found = Some(mid);
                    break;
                }
                std::cmp::Ordering::Less => lo = mid + 1,
                std::cmp::Ordering::Greater => hi = mid,
            }
        }
        let Some(i) = found else {
            return Ok(Vec::new());
        };
        let start = self.val_offs[i];
        let val = self.read_at(
            self.vals_at + u64::from(start),
            (self.val_offs[i + 1] - start) as usize,
        )?;
        let count = *val.first().unwrap_or(&0) as usize;
        // Splits ride after the hits, three bytes each; older readers
        // stop at the hits and never see them.
        let splits_at = 1 + count * 6;
        let mut hits = Vec::with_capacity(count);
        for h in 0..count {
            let at = 1 + h * 6;
            let Some(raw) = val.get(at..at + 6) else {
                break;
            };
            let entry = u32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]]) as usize;
            let tag = u16::from_le_bytes([raw[4], raw[5]]) as usize;
            if entry + 1 >= self.ent_offs.len() {
                continue;
            }
            let from = self.ent_offs[entry];
            let bytes = self.read_at(
                self.ents_at + u64::from(from),
                (self.ent_offs[entry + 1] - from) as usize,
            )?;
            let entry: serde_json::Value =
                serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            let split = val
                .get(splits_at + h * 3..splits_at + h * 3 + 3)
                .filter(|s| s[1] != NO_SPLIT)
                .map(|s| [s[0], s[1], s[2]]);
            hits.push(Hit {
                tags: self.tags.get(tag).cloned().unwrap_or_default(),
                entry,
                split,
            });
        }
        Ok(hits)
    }
}

/// The lookup key a form folds to (dict-pack.ts packKey): lowercase,
/// curly apostrophes straight, trimmed. Packs store NFC forms and
/// webview text arrives NFC.
fn fold(form: &str) -> String {
    form.trim()
        .to_lowercase()
        .replace(['\u{2019}', '\u{02bc}'], "'")
}

fn valid_lang(lang: &str) -> bool {
    (2..=3).contains(&lang.len()) && lang.bytes().all(|b| b.is_ascii_lowercase())
}

fn dict_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("dictionaries"))
}

fn open_packs() -> &'static Mutex<HashMap<String, Arc<Pack>>> {
    static PACKS: OnceLock<Mutex<HashMap<String, Arc<Pack>>>> = OnceLock::new();
    PACKS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn installing() -> &'static Mutex<HashSet<String>> {
    static BUSY: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    BUSY.get_or_init(|| Mutex::new(HashSet::new()))
}

fn pack_for(app: &AppHandle, lang: &str) -> Result<Option<Arc<Pack>>, String> {
    let mut packs = open_packs()
        .lock()
        .map_err(|_| "packs lock poisoned".to_string())?;
    if let Some(p) = packs.get(lang) {
        return Ok(Some(p.clone()));
    }
    let path = dict_dir(app)?.join(format!("{lang}.dict"));
    if !path.exists() {
        return Ok(None);
    }
    let pack = Arc::new(Pack::open(&path)?);
    packs.insert(lang.to_string(), pack.clone());
    Ok(Some(pack))
}

/// The installed pack's version, or null when none is installed.
#[tauri::command]
pub fn dict_installed(app: AppHandle, lang: String) -> Option<String> {
    if !valid_lang(&lang) {
        return None;
    }
    installed_version(&dict_dir(&app).ok()?, &lang)
}

/// Hits for each form, in order (an empty list where a form is
/// unknown); null when the language's pack isn't installed.
#[tauri::command]
pub async fn dict_lookup(
    app: AppHandle,
    lang: String,
    forms: Vec<String>,
) -> Result<Option<Vec<Vec<Hit>>>, String> {
    if !valid_lang(&lang) {
        return Err("bad-lang".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(pack) = pack_for(&app, &lang)? else {
            return Ok(None);
        };
        forms
            .iter()
            .take(8)
            .map(|f| pack.lookup(f))
            .collect::<Result<Vec<_>, _>>()
            .map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Clone, Serialize)]
struct Progress {
    lang: String,
    received: u64,
    total: Option<u64>,
}

/// Download (or update) a language's pack. Resolves the installed
/// version: at once when it is already current. Machine codes:
/// `bad-lang`, `busy`, `no-pack` (the release has none for it),
/// `failed`, `bad-checksum`.
#[tauri::command]
pub async fn dict_install(app: AppHandle, lang: String) -> Result<String, String> {
    if !valid_lang(&lang) {
        return Err("bad-lang".into());
    }
    {
        let mut busy = installing().lock().map_err(|_| "failed".to_string())?;
        if !busy.insert(lang.clone()) {
            return Err("busy".into());
        }
    }
    let result = install(&app, &lang).await;
    if let Ok(mut busy) = installing().lock() {
        busy.remove(&lang);
    }
    result
}

async fn install(app: &AppHandle, lang: &str) -> Result<String, String> {
    let dir = dict_dir(app)?;
    let version = fetch_pack(&dir, lang, RELEASE_URL, |received, total| {
        let _ = app.emit(
            PROGRESS_EVENT,
            Progress {
                lang: lang.to_string(),
                received,
                total,
            },
        );
    })
    .await?;
    // A pack opened before the swap still reads the old file.
    if let Ok(mut packs) = open_packs().lock() {
        packs.remove(lang);
    }
    Ok(version)
}

/// The installed version recorded beside a pack in `dir`.
fn installed_version(dir: &Path, lang: &str) -> Option<String> {
    if !dir.join(format!("{lang}.dict")).exists() {
        return None;
    }
    std::fs::read_to_string(dir.join(format!("{lang}.version")))
        .ok()
        .map(|v| v.trim().to_string())
}

/// Fetch the manifest from `release`, and when its pack for `lang` is
/// newer than the one in `dir`, stream it down (reporting bytes so
/// far), check its SHA-256 and unpack it into place.
async fn fetch_pack(
    dir: &Path,
    lang: &str,
    release: &str,
    progress: impl Fn(u64, Option<u64>),
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(900))
        .user_agent("ccez-llm dictionaries")
        .build()
        .map_err(|_| "failed".to_string())?;
    let manifest_bytes = client
        .get(format!("{release}/manifest.json"))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|_| "failed".to_string())?
        .bytes()
        .await
        .map_err(|_| "failed".to_string())?;
    let manifest: serde_json::Value =
        serde_json::from_slice(&manifest_bytes).map_err(|_| "failed".to_string())?;
    let entry = &manifest["packs"][lang];
    let (Some(file), Some(version), Some(sha)) = (
        entry["file"].as_str(),
        entry["version"].as_str(),
        entry["sha256"].as_str(),
    ) else {
        return Err("no-pack".into());
    };
    if installed_version(dir, lang).as_deref() == Some(version) {
        return Ok(version.to_string());
    }
    if !file
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
    {
        return Err("failed".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let gz_path = dir.join(format!("{lang}.dict.gz.part"));
    let mut res = client
        .get(format!("{release}/{file}"))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|_| "failed".to_string())?;
    let total = res.content_length();
    let mut out = File::create(&gz_path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut received = 0u64;
    while let Some(chunk) = res.chunk().await.map_err(|_| "failed".to_string())? {
        out.write_all(&chunk).map_err(|e| e.to_string())?;
        hasher.update(&chunk);
        received += chunk.len() as u64;
        progress(received, total);
    }
    drop(out);
    let digest = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    if digest != sha {
        let _ = std::fs::remove_file(&gz_path);
        return Err("bad-checksum".into());
    }
    let (dir_owned, lang_owned, version_owned) =
        (dir.to_path_buf(), lang.to_string(), version.to_string());
    tauri::async_runtime::spawn_blocking(move || {
        unpack(&dir_owned, &lang_owned, &gz_path, &version_owned)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(version.to_string())
}

/// Gunzip a downloaded pack beside the live one, check it opens, then
/// swap it in and record its version.
fn unpack(dir: &Path, lang: &str, gz_path: &Path, version: &str) -> Result<(), String> {
    let tmp = dir.join(format!("{lang}.dict.part"));
    {
        let gz = File::open(gz_path).map_err(|e| e.to_string())?;
        let mut decoder = flate2::read::GzDecoder::new(std::io::BufReader::new(gz));
        let mut out = File::create(&tmp).map_err(|e| e.to_string())?;
        std::io::copy(&mut decoder, &mut out).map_err(|e| e.to_string())?;
    }
    let _ = std::fs::remove_file(gz_path);
    Pack::open(&tmp)?;
    if let Ok(mut packs) = open_packs().lock() {
        packs.remove(lang);
    }
    std::fs::rename(&tmp, dir.join(format!("{lang}.dict"))).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(format!("{lang}.version")), version).map_err(|e| e.to_string())?;
    Ok(())
}

/// One installed pack, for Settings.
#[derive(Debug, Serialize, PartialEq)]
pub struct Installed {
    pub lang: String,
    pub version: String,
    pub bytes: u64,
}

/// Installed packs in `dir`, by language code.
fn installed_packs(dir: &Path) -> Vec<Installed> {
    let Ok(read) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<Installed> = read
        .filter_map(Result::ok)
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            let lang = name.strip_suffix(".dict")?;
            if !valid_lang(lang) {
                return None;
            }
            Some(Installed {
                lang: lang.to_string(),
                version: installed_version(dir, lang)?,
                bytes: e.metadata().ok()?.len(),
            })
        })
        .collect();
    out.sort_by(|a, b| a.lang.cmp(&b.lang));
    out
}

/// Every installed pack with its size on disk (Settings).
#[tauri::command]
pub fn dict_list(app: AppHandle) -> Vec<Installed> {
    dict_dir(&app)
        .map(|d| installed_packs(&d))
        .unwrap_or_default()
}

/// One pack the release offers: its download and unpacked sizes and
/// version, for the dictionary manager.
#[derive(Debug, Serialize, PartialEq)]
pub struct Offered {
    pub bytes: u64,
    pub unpacked: u64,
    pub version: String,
}

/// The packs a release manifest offers, by language code.
fn offered_packs(manifest: &serde_json::Value) -> HashMap<String, Offered> {
    manifest["packs"]
        .as_object()
        .map(|packs| {
            packs
                .iter()
                .filter(|(lang, _)| valid_lang(lang))
                .filter_map(|(lang, p)| {
                    Some((
                        lang.clone(),
                        Offered {
                            bytes: p["bytes"].as_u64()?,
                            unpacked: p["unpacked"].as_u64()?,
                            version: p["version"].as_str()?.to_string(),
                        },
                    ))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Every pack the release offers (the manager's download sizes);
/// null when the manifest can't be fetched.
#[tauri::command]
pub async fn dict_catalog() -> Option<HashMap<String, Offered>> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("ccez-llm dictionaries")
        .build()
        .ok()?;
    let bytes = client
        .get(format!("{RELEASE_URL}/manifest.json"))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .ok()?
        .bytes()
        .await
        .ok()?;
    let manifest: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    Some(offered_packs(&manifest))
}

/// Delete a language's pack (Settings).
#[tauri::command]
pub fn dict_remove(app: AppHandle, lang: String) -> Result<(), String> {
    if !valid_lang(&lang) {
        return Err("bad-lang".into());
    }
    if let Ok(mut packs) = open_packs().lock() {
        packs.remove(&lang);
    }
    let dir = dict_dir(&app)?;
    for ext in ["dict", "version"] {
        let _ = std::fs::remove_file(dir.join(format!("{lang}.{ext}")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A two-entry pack in the dict-pack.ts layout.
    fn sample_pack() -> Vec<u8> {
        let header = br#"{"lang":"fr","version":"1","sources":[],"tags":["","participle past"]}"#;
        let mut keys: Vec<(&str, Vec<(u32, u16)>)> = vec![
            ("franchir", vec![(0, 0)]),
            ("franchi", vec![(0, 1)]),
            ("digue", vec![(1, 0)]),
        ];
        // franchi splits franch + i; the headword's split isn't known.
        let split = |k: &str| match k {
            "franchi" => Some([0u8, 6, 0]),
            "franchir" => Some([0u8, NO_SPLIT, 0]),
            _ => None,
        };
        keys.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
        let entries = [
            br#"{"w":"franchir","p":"verb","s":["to cross"]}"#.to_vec(),
            br#"{"w":"digue","p":"noun","g":"feminine","s":["dike"]}"#.to_vec(),
        ];
        let mut out = MAGIC.to_vec();
        out.extend((header.len() as u32).to_le_bytes());
        out.extend(header);
        out.extend((keys.len() as u32).to_le_bytes());
        out.extend((entries.len() as u32).to_le_bytes());
        let vals: Vec<Vec<u8>> = keys
            .iter()
            .map(|(k, hits)| {
                let mut v = vec![hits.len() as u8];
                for (e, t) in hits {
                    v.extend(e.to_le_bytes());
                    v.extend(t.to_le_bytes());
                }
                if let Some(s) = split(k) {
                    v.extend(s);
                }
                v
            })
            .collect();
        let offsets = |lens: Vec<usize>| {
            let mut o = vec![0u32];
            for l in lens {
                o.push(o.last().unwrap() + l as u32);
            }
            o
        };
        for o in offsets(keys.iter().map(|k| k.0.len()).collect())
            .into_iter()
            .chain(offsets(vals.iter().map(Vec::len).collect()))
            .chain(offsets(entries.iter().map(Vec::len).collect()))
        {
            out.extend(o.to_le_bytes());
        }
        for (k, _) in &keys {
            out.extend(k.as_bytes());
        }
        for v in vals {
            out.extend(v);
        }
        for e in entries {
            out.extend(e);
        }
        out
    }

    #[test]
    fn looks_forms_up_to_their_entries() {
        let dir = std::env::temp_dir().join(format!("ccez-dict-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("fr.dict");
        std::fs::write(&path, sample_pack()).unwrap();
        let pack = Pack::open(&path).unwrap();
        let hits = pack.lookup("Franchi").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].tags, "participle past");
        assert_eq!(hits[0].entry["w"], "franchir");
        assert_eq!(hits[0].split, Some([0, 6, 0]));
        assert_eq!(pack.lookup("franchir").unwrap()[0].split, None);
        // A pack written before splits: no split, same hits.
        assert_eq!(pack.lookup("digue").unwrap()[0].split, None);
        assert_eq!(pack.lookup("digue").unwrap()[0].entry["g"], "feminine");
        assert!(pack.lookup("nope").unwrap().is_empty());
        std::fs::write(dir.join("fr.version"), "2026.10.24").unwrap();
        std::fs::write(dir.join("xx.part"), b"half").unwrap();
        let listed = installed_packs(&dir);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].lang, "fr");
        assert_eq!(listed[0].version, "2026.10.24");
        assert_eq!(listed[0].bytes, sample_pack().len() as u64);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rejects_files_that_are_not_packs() {
        let dir = std::env::temp_dir().join(format!("ccez-dict-bad-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("x.dict");
        std::fs::write(&path, b"not a pack at all").unwrap();
        assert!(Pack::open(&path).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// A real pack built by scripts/dict-build.ts (unpacked):
    /// `CCEZ_DICT_PACK=/path/fr.dict cargo test --lib real_pack -- --ignored`.
    #[test]
    #[ignore]
    fn real_pack() {
        let path = std::env::var("CCEZ_DICT_PACK").expect("CCEZ_DICT_PACK");
        let pack = Pack::open(Path::new(&path)).unwrap();
        for word in ["franchi", "pleut", "Maisons", "l\u{2019}"] {
            let hits = pack.lookup(word).unwrap();
            println!(
                "{word}: {}",
                serde_json::to_string(
                    &hits
                        .iter()
                        .map(|h| (&h.tags, &h.entry["w"]))
                        .collect::<Vec<_>>()
                )
                .unwrap()
            );
            assert!(!hits.is_empty(), "{word}");
        }
        // Packs carry each form's split: parl + é.
        let parle = pack.lookup("parlé").unwrap();
        assert!(parle.iter().any(|h| h.split == Some([0, 4, 0])));
    }

    /// The real release, end to end: manifest, download, checksum,
    /// unpack, lookup. `cargo test --lib release_download -- --ignored`.
    #[test]
    #[ignore]
    fn release_download() {
        let dir = std::env::temp_dir().join(format!("ccez-dict-net-{}", std::process::id()));
        let ticks = std::sync::atomic::AtomicU64::new(0);
        let version =
            tauri::async_runtime::block_on(fetch_pack(&dir, "fr", RELEASE_URL, |_, _| {
                ticks.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            }))
            .unwrap();
        assert!(ticks.into_inner() > 0);
        assert_eq!(
            installed_version(&dir, "fr").as_deref(),
            Some(version.as_str())
        );
        let pack = Pack::open(&dir.join("fr.dict")).unwrap();
        assert_eq!(pack.lookup("franchi").unwrap()[0].entry["w"], "franchir");
        // A pack beyond the first three, reached by its unstressed spelling.
        tauri::async_runtime::block_on(fetch_pack(&dir, "ru", RELEASE_URL, |_, _| {})).unwrap();
        let ru = Pack::open(&dir.join("ru.dict")).unwrap();
        assert_eq!(ru.lookup("говорю").unwrap()[0].entry["w"], "говорить");
        // Current already: nothing downloads again.
        let again = tauri::async_runtime::block_on(fetch_pack(&dir, "fr", RELEASE_URL, |_, _| {
            panic!("downloaded twice")
        }))
        .unwrap();
        assert_eq!(again, version);
        assert_eq!(
            tauri::async_runtime::block_on(fetch_pack(&dir, "xx", RELEASE_URL, |_, _| {})),
            Err("no-pack".to_string())
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reads_what_a_manifest_offers() {
        let manifest = serde_json::json!({"v": 1, "packs": {
            "fr": {"file": "fr.dict.gz", "version": "1", "bytes": 7, "unpacked": 24, "sha256": "x"},
            "../x": {"version": "1", "bytes": 1, "unpacked": 1},
            "de": {"version": "1"}
        }});
        let offered = offered_packs(&manifest);
        assert_eq!(offered.len(), 1);
        assert_eq!(
            offered["fr"],
            Offered {
                bytes: 7,
                unpacked: 24,
                version: "1".into()
            }
        );
    }

    #[test]
    fn folds_and_validates() {
        assert_eq!(fold(" L\u{2019}Homme "), "l'homme");
        assert!(valid_lang("fr") && valid_lang("grc"));
        assert!(!valid_lang("../x") && !valid_lang("FR") && !valid_lang("f"));
    }
}
