//! Desktop summon kit + study-sheet output.
//!
//! Covers the desktop-only runtime pieces the web layer cannot reach:
//! a summon/hide affordance (OS-global hotkey on macOS, in-app chord in
//! the frontend), a system tray with Show/Quit on Windows/Linux only
//! (macOS shows no menu-bar icon — the Dock owns Show/Quit there),
//! single-instance focus
//! (a second launch focuses the running app instead of opening a new
//! window), `ccez://` deep links into a chat, sleep prevention while
//! speech or a reply streams, and study-sheet export (native share-out
//! reads the file this backend writes; print-to-PDF is a print
//! stylesheet in the frontend calling `window.print()`).
//!
//! Shape: every `pub` helper below the runtime line is pure and
//! unit-tested here, so `cargo test` covers the contracts on any host
//! (including this Mac). The OS wiring itself is `#[cfg(desktop)]` —
//! Windows/Linux-only paths are called out as unverified-on-device in
//! the submit notes, never claimed green. Crates: tray comes from the
//! `tray-icon` feature on the existing `tauri` dep, the summon chord
//! from `tauri-plugin-global-shortcut` (desktop-only upstream), and
//! everything else is `std` + `serde`.

// Compiled on every platform for the deep-link half; the summon kit
// below is desktop-only, so mobile builds see unused helpers.
#![cfg_attr(not(desktop), allow(dead_code, unused_imports))]

use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Emitter, Manager, Runtime};

/// In-app/OS summon chord shown in help copy. The global-shortcut
/// plugin owns this combo system-wide ("CommandOrControl" maps to
/// ⌘ on macOS, Ctrl elsewhere); the frontend owns the same chord
/// while its window is focused.
#[cfg(all(desktop, not(target_os = "macos")))]
pub const SUMMON_SHORTCUT_LABEL: &str = "Ctrl+Shift+Space";
/// Custom URL scheme the OS routes to the app (registered by
/// tauri-plugin-deep-link: NSIS registry keys on Windows, the bundle's
/// URL types on macOS/iOS). Routes:
/// `ccez-llm://new`, `ccez-llm://chat/<id>`, `ccez-llm://chat?id=<id>`,
/// `ccez-llm://send?text=<text>` (prefill the composer, like Android's
/// share target), and `ccez-llm://annotate|speak|inspect?text=<text>`
/// (Android's PROCESS_TEXT actions).
pub const DEEP_LINK_SCHEME: &str = "ccez-llm";
/// The scheme before the rename, still parsed (never registered).
pub const LEGACY_DEEP_LINK_SCHEME: &str = "ccez";
/// Window event carrying a [`DeepLinkPayload`] to the frontend.
pub const DEEP_LINK_EVENT: &str = "deep-link";
/// Loopback port for the single-instance handoff. First launch binds
/// it; a second launch connects, forwards focus/URL, and exits.
pub const SINGLETON_PORT: u16 = 47471;
/// Tray icon id (single tray per app; Windows/Linux only).
#[cfg(all(desktop, not(target_os = "macos")))]
pub const TRAY_ID: &str = "ccez-tray";
/// Tray menu item: show + focus the main window (Windows/Linux only).
#[cfg(all(desktop, not(target_os = "macos")))]
pub const TRAY_SHOW_ID: &str = "tray-show";
/// Tray menu item: quit the app (Windows/Linux only).
#[cfg(all(desktop, not(target_os = "macos")))]
pub const TRAY_QUIT_ID: &str = "tray-quit";
/// Cap for an exported study sheet: a foreign chat id or a giant
/// history must not flood the temp dir.
pub const MAX_SHEET_CHARS: usize = 200_000;
/// Cap for inbound deep-link chat ids (same flood rule as
/// `clean_external` in `annotate.rs`).
pub const MAX_DEEP_LINK_ID_CHARS: usize = 200;

// ---------------------------------------------------------------------------
// Deep links (pure)
// ---------------------------------------------------------------------------

/// Frontend payload for [`DEEP_LINK_EVENT`] and the pending-link drain:
/// open one chat, or mint a fresh one.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DeepLinkPayload {
    pub action: String,
    pub chat_id: Option<String>,
}

impl DeepLinkPayload {
    pub fn open_chat(id: &str) -> Self {
        Self {
            action: "open-chat".into(),
            chat_id: Some(id.into()),
        }
    }

    pub fn new_chat() -> Self {
        Self {
            action: "new-chat".into(),
            chat_id: None,
        }
    }
}

/// A parsed deep link: navigate (open or mint a chat) or hand text to
/// the same `annotate-external` path Android shares use.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DeepLink {
    Nav(DeepLinkPayload),
    Text {
        text: String,
        action: Option<String>,
    },
}

/// Strip either accepted scheme (`ccez-llm://` or legacy `ccez://`).
pub fn strip_link_scheme(url: &str) -> Option<&str> {
    let url = url.trim();
    url.strip_prefix(&format!("{DEEP_LINK_SCHEME}://"))
        .or_else(|| url.strip_prefix(&format!("{LEGACY_DEEP_LINK_SCHEME}://")))
}

/// Is this process arg / forwarded string one of our deep links?
pub fn is_deep_link(arg: &str) -> bool {
    strip_link_scheme(arg).is_some()
}

/// Parse a deep link. Anything else (wrong scheme, empty id or text,
/// extra path) is `None`: deep links are foreign input and never panic
/// the shell. Text is trimmed and capped by `annotate::clean_external`.
pub fn parse_link(url: &str) -> Option<DeepLink> {
    let rest = strip_link_scheme(url)?;
    let (path, query) = match rest.split_once('?') {
        Some((p, q)) => (p, q),
        None => (rest, ""),
    };
    let path = path.trim_end_matches('/');
    match path {
        "new" => return Some(DeepLink::Nav(DeepLinkPayload::new_chat())),
        "chat" => {
            let id = query_param(query, "id")?;
            return clean_link_id(&id).map(|id| DeepLink::Nav(DeepLinkPayload::open_chat(&id)));
        }
        "send" | "annotate" | "speak" | "inspect" => {
            let text = crate::annotate::clean_external(&query_param(query, "text")?)?;
            let action = crate::annotate::clean_action(path);
            return Some(DeepLink::Text { text, action });
        }
        _ => {}
    }
    if let Some(id) = path.strip_prefix("chat/") {
        let id = percent_decode(id);
        return clean_link_id(&id).map(|id| DeepLink::Nav(DeepLinkPayload::open_chat(&id)));
    }
    None
}

/// Navigation-only view of [`parse_link`] (text links are `None`).
pub fn parse_deep_link(url: &str) -> Option<DeepLinkPayload> {
    match parse_link(url)? {
        DeepLink::Nav(payload) => Some(payload),
        DeepLink::Text { .. } => None,
    }
}

/// One `k=v` query arg, percent-decoded. Pure so the deep-link unit
/// tests cover it without a URL crate (no new deps).
pub fn query_param(query: &str, key: &str) -> Option<String> {
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            if k == key {
                return Some(percent_decode(v));
            }
        }
    }
    None
}

/// Minimal percent-decoder (`%20`, `%2F`, `+` as space). Decodes to
/// bytes first so multi-byte UTF-8 (`%C3%A9`, CJK) survives; malformed
/// sequences pass through literally and invalid UTF-8 is replaced,
/// never an error.
pub fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' => {
                let hex = bytes.get(i + 1..i + 3).and_then(|h| std::str::from_utf8(h).ok());
                match hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    Some(v) => {
                        out.push(v);
                        i += 3;
                    }
                    None => {
                        out.push(b'%');
                        i += 1;
                    }
                }
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Deep-link ids are chat ids, not paths: nonempty, no slashes, capped.
fn clean_link_id(id: &str) -> Option<String> {
    let trimmed = id.trim();
    if trimmed.is_empty() || trimmed.contains('/') || trimmed.contains('\\') {
        return None;
    }
    Some(trimmed.chars().take(MAX_DEEP_LINK_ID_CHARS).collect())
}

/// Windows send-text chord (send_selection.rs): the copied selection
/// wins; with nothing copied, the clipboard text the user already had
/// goes instead. Cleaned and capped like every external share.
pub fn pick_sent_text(copied: Option<String>, clipboard: Option<String>) -> Option<String> {
    copied
        .as_deref()
        .and_then(crate::annotate::clean_external)
        .or_else(|| clipboard.as_deref().and_then(crate::annotate::clean_external))
}

// ---------------------------------------------------------------------------
// Single-instance protocol (pure)
// ---------------------------------------------------------------------------

/// Messages a second launch forwards to the running app.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SingletonMsg {
    /// Just focus the running window.
    Focus,
    /// Open a `ccez://` URL after focusing.
    OpenUrl(String),
}

/// Encode for the loopback handoff (one line, `\n`-terminated).
pub fn encode_singleton(msg: &SingletonMsg) -> String {
    match msg {
        SingletonMsg::Focus => "focus\n".into(),
        SingletonMsg::OpenUrl(url) => format!("open {}\n", url.trim()),
    }
}

/// Decode one handoff line. Unknown lines are `None` (a stale client
/// must not drive the running app).
pub fn decode_singleton(line: &str) -> Option<SingletonMsg> {
    let line = line.trim();
    if line == "focus" {
        return Some(SingletonMsg::Focus);
    }
    if let Some(url) = line.strip_prefix("open ") {
        let url = url.trim();
        if !url.is_empty() {
            return Some(SingletonMsg::OpenUrl(url.into()));
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Sleep claims (pure)
// ---------------------------------------------------------------------------

/// Refcounted sleep-prevention claims. The platform guard engages on
/// the first live claim and releases when the last one drops, so
/// overlapping speech + streaming never unblock each other early.
#[derive(Clone, Debug, Default)]
pub struct SleepClaims {
    next_id: u64,
    active: Vec<(u64, String)>,
}

impl SleepClaims {
    /// Take a claim; returns its id for [`SleepClaims::release`].
    pub fn acquire(&mut self, reason: impl Into<String>) -> u64 {
        self.next_id += 1;
        let id = self.next_id;
        self.active.push((id, reason.into()));
        id
    }

    /// Drop a claim. True when it was live. Ids never repeat, so a
    /// double release is a silent no-op, never a wrong unblock.
    pub fn release(&mut self, id: u64) -> bool {
        let before = self.active.len();
        self.active.retain(|(live, _)| *live != id);
        self.active.len() != before
    }

    /// Live claim count (the guard engages above zero).
    pub fn count(&self) -> usize {
        self.active.len()
    }
}

/// Raw Win32 flags behind the Windows sleep guard, kept pure (and
/// unit-tested) so the Windows-only call site stays one line:
///
/// - engage: `ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED`
/// - release: `ES_CONTINUOUS`
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn windows_sleep_flags(engage: bool) -> u32 {
    const ES_CONTINUOUS: u32 = 0x8000_0000;
    const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;
    const ES_DISPLAY_REQUIRED: u32 = 0x0000_0002;
    if engage {
        ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
    } else {
        ES_CONTINUOUS
    }
}

// ---------------------------------------------------------------------------
// Study sheets (pure)
// ---------------------------------------------------------------------------

/// One chat message for sheet export (mirrors the frontend shape in
/// `src/lib/desktop.ts`; roles are `"user"` / `"assistant"`).
#[derive(Clone, Debug, serde::Deserialize)]
pub struct StudyLine {
    pub role: String,
    pub content: String,
}

/// Render a chat as a study-sheet Markdown doc for share-out (native
/// share reads the exported file) and print-to-PDF (the frontend print
/// stylesheet renders this same text). Empty messages are skipped; the
/// whole doc caps at [`MAX_SHEET_CHARS`] with a truncation note.
pub fn study_sheet_markdown(title: &str, messages: &[StudyLine]) -> String {
    let title = title.trim();
    let title = if title.is_empty() { "Untitled chat" } else { title };
    let kept: Vec<(&str, String)> = messages
        .iter()
        .map(|m| {
            let heading = match m.role.as_str() {
                "user" => "You",
                "assistant" => "Ccez",
                other => other,
            };
            (heading, m.content.trim().to_string())
        })
        .filter(|(_, text)| !text.is_empty())
        .collect();
    let mut out = format!(
        "# {title}\n\n*Ccez LLM study sheet — {} message{}.*\n",
        kept.len(),
        if kept.len() == 1 { "" } else { "s" }
    );
    for (heading, text) in &kept {
        out.push_str(&format!("\n---\n\n## {heading}\n\n{text}\n"));
    }
    if out.len() > MAX_SHEET_CHARS {
        let mut cut = MAX_SHEET_CHARS;
        while !out.is_char_boundary(cut) {
            cut -= 1;
        }
        out.truncate(cut);
        out.push_str("\n\n*(…truncated — the chat is longer than one study sheet.)*\n");
    }
    out
}

/// Filename-safe stem for the exported sheet: runs of anything but
/// ASCII alphanumerics collapse to one `-`, capped at 40 chars,
/// `chat` when nothing survives.
pub fn sanitize_file_stem(title: &str) -> String {
    let mut stem = String::new();
    let mut dash = false;
    for ch in title.chars() {
        if ch.is_ascii_alphanumeric() {
            stem.push(ch.to_ascii_lowercase());
            dash = false;
        } else if !dash && !stem.is_empty() {
            stem.push('-');
            dash = true;
        }
        if stem.len() >= 40 {
            break;
        }
    }
    let stem = stem.trim_matches('-').to_string();
    if stem.is_empty() {
        "chat".into()
    } else {
        stem
    }
}

// ---------------------------------------------------------------------------
// Tauri commands (every platform; non-desktop builds report unsupported)
// ---------------------------------------------------------------------------

fn claims_slot() -> &'static Mutex<SleepClaims> {
    static CLAIMS: OnceLock<Mutex<SleepClaims>> = OnceLock::new();
    CLAIMS.get_or_init(|| Mutex::new(SleepClaims::default()))
}

fn lock_claims() -> std::sync::MutexGuard<'static, SleepClaims> {
    claims_slot().lock().unwrap_or_else(|e| e.into_inner())
}

/// Block OS sleep while speech or a reply streams. Returns a claim id
/// for [`desktop_sleep_unblock`]; the guard engages on the first live
/// claim. Outside the desktop shell this reports unsupported and the
/// frontend falls back to the Screen Wake Lock API.
#[tauri::command]
pub fn desktop_sleep_block(reason: String) -> Result<u64, String> {
    #[cfg(not(desktop))]
    {
        let _ = reason;
        return Err("sleep prevention requires the desktop app".into());
    }
    #[cfg(desktop)]
    {
        let mut claims = lock_claims();
        let first = claims.count() == 0;
        let id = claims.acquire(reason.clone());
        if first {
            if let Err(e) = engage_sleep_guard(&reason) {
                claims.release(id);
                return Err(e);
            }
        }
        Ok(id)
    }
}

/// Drop a sleep claim from [`desktop_sleep_block`]; the guard releases
/// when the last live claim drops. Unknown ids are a silent no-op.
#[tauri::command]
pub fn desktop_sleep_unblock(id: u64) -> Result<bool, String> {
    #[cfg(not(desktop))]
    {
        let _ = id;
        return Err("sleep prevention requires the desktop app".into());
    }
    #[cfg(desktop)]
    {
        let mut claims = lock_claims();
        let released = claims.release(id);
        if claims.count() == 0 {
            disengage_sleep_guard();
        }
        Ok(released)
    }
}

/// Write the chat as a study-sheet Markdown file into the OS temp dir
/// and return its path. Native share-out reads this file; failures
/// carry the OS message.
#[tauri::command]
pub fn desktop_export_study_sheet(
    title: String,
    messages: Vec<StudyLine>,
) -> Result<String, String> {
    let md = study_sheet_markdown(&title, &messages);
    let stem = sanitize_file_stem(&title);
    let path = std::env::temp_dir().join(format!("{stem}-study-sheet.md"));
    std::fs::write(&path, md).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Deep link that arrived before the frontend registered its listener
/// (cold start, or a second-launch forward while the view reloads).
/// Drains to `None`; the live path is the [`DEEP_LINK_EVENT`] emit.
#[tauri::command]
pub fn desktop_drain_pending_link() -> Result<Option<DeepLinkPayload>, String> {
    Ok(lock_pending().take())
}

fn pending_slot() -> &'static Mutex<Option<DeepLinkPayload>> {
    static PENDING: OnceLock<Mutex<Option<DeepLinkPayload>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(None))
}

fn lock_pending() -> std::sync::MutexGuard<'static, Option<DeepLinkPayload>> {
    pending_slot().lock().unwrap_or_else(|e| e.into_inner())
}

/// Stash + emit a deep link: live listeners get [`DEEP_LINK_EVENT`],
/// early arrivals wait in the drain slot for the frontend.
fn deliver_link<R: Runtime>(app: &AppHandle<R>, link: DeepLinkPayload) {
    *lock_pending() = Some(link.clone());
    let _ = app.emit(DEEP_LINK_EVENT, link);
}

/// Route one incoming deep link: navigation goes to the deep-link
/// event, text to the `annotate-external` path Android shares use
/// (it parks until the frontend listens, so cold starts keep it).
pub fn route_link<R: Runtime>(app: &AppHandle<R>, url: &str) {
    match parse_link(url) {
        Some(DeepLink::Nav(link)) => deliver_link(app, link),
        Some(DeepLink::Text { text, action }) => crate::annotate::emit(Some(text), action),
        None => {}
    }
}

// ---------------------------------------------------------------------------
// Platform sleep guards (desktop only)
// ---------------------------------------------------------------------------

/// Held `caffeinate` / `systemd-inhibit` child while a claim is live
/// (macOS / Linux). Killed on the last release.
#[cfg(all(desktop, not(target_os = "windows")))]
fn guard_child_slot() -> &'static Mutex<Option<std::process::Child>> {
    static CHILD: OnceLock<Mutex<Option<std::process::Child>>> = OnceLock::new();
    CHILD.get_or_init(|| Mutex::new(None))
}

#[cfg(desktop)]
fn engage_sleep_guard(reason: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // `caffeinate -d -i`: keep the display and idle sleep off while
        // speech or a reply streams. std-only (no IOKit bindings are
        // vendored); the child dies with the last release.
        let child = std::process::Command::new("caffeinate")
            .args(["-d", "-i"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("sleep guard failed to start: {e}"))?;
        let _ = reason;
        *guard_child_slot()
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(child);
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        // Win32 thread execution state (vendored `windows` crate).
        // UNVERIFIED ON DEVICE: compiles only on Windows; covered here
        // by the `windows_sleep_flags` unit test, never run on hardware.
        use windows::Win32::System::Power::{EXECUTION_STATE, SetThreadExecutionState};
        let _ = reason;
        unsafe {
            SetThreadExecutionState(EXECUTION_STATE(windows_sleep_flags(true)));
        }
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        // Best-effort session guard; hard failure (no systemd) reports
        // unsupported so the frontend rides Wake Lock instead.
        // UNVERIFIED ON DEVICE: needs a Linux desktop session.
        let child = std::process::Command::new("systemd-inhibit")
            .args([
                "--what=sleep:idle",
                "--who=Ccez LLM",
                "--why",
                reason,
                "--mode=block",
                "sleep",
                "infinity",
            ])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|_| "sleep prevention is not supported on this session".to_string())?;
        *guard_child_slot()
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(child);
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = reason;
        Err("sleep prevention is not supported on this platform".into())
    }
}

#[cfg(desktop)]
fn disengage_sleep_guard() {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::System::Power::{EXECUTION_STATE, SetThreadExecutionState};
        unsafe {
            SetThreadExecutionState(EXECUTION_STATE(windows_sleep_flags(false)));
        }
    }
    #[cfg(all(desktop, not(target_os = "windows"), any(target_os = "macos", target_os = "linux")))]
    {
        let mut slot = guard_child_slot()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(mut child) = slot.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

// ---------------------------------------------------------------------------
// Desktop wiring: tray, single instance, hotkey, startup args
// ---------------------------------------------------------------------------

/// Show + focus the main window (tray clicks, second launch, summon).
#[cfg(desktop)]
pub(crate) fn focus_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Wire the whole kit. Call once from `setup`, before any second
/// launch can forward into us. A second instance exits inside
/// `ensure_single_instance` and never reaches the tray build.
#[cfg(desktop)]
pub fn wire(app: &AppHandle) -> tauri::Result<()> {
    ensure_single_instance(app);
    // No menu-bar icon on macOS (owner request): the Dock owns Show/Quit.
    // Windows/Linux keep the tray — quitting needs it there.
    #[cfg(not(target_os = "macos"))]
    build_tray(app)?;
    install_summon_hotkey(app);
    // Window capture is macOS-only (capture.rs): elsewhere these chords
    // would only steal Ctrl+Shift+O/U from every other app.
    #[cfg(target_os = "macos")]
    install_capture_hotkey(app);
    #[cfg(target_os = "macos")]
    install_area_hotkey(app);
    #[cfg(target_os = "windows")]
    crate::send_selection::install(app);
    handle_startup_args(app);
    Ok(())
}

/// System tray (Windows/Linux only): Show focuses the window, Quit
/// exits. Left-click shows too (the menu stays the discoverable path).
#[cfg(all(desktop, not(target_os = "macos")))]
fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, TRAY_SHOW_ID, "Show Ccez LLM", true, None::<&str>)?,
            &MenuItem::with_id(app, TRAY_QUIT_ID, "Quit", true, None::<&str>)?,
        ],
    )?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip(format!("Ccez LLM ({SUMMON_SHORTCUT_LABEL} to summon)"))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            TRAY_SHOW_ID => focus_main(app),
            TRAY_QUIT_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                focus_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Single instance: bind the loopback port; on success serve focus/URL
/// forwards on a thread, on failure forward our own args to the owner
/// and exit (the running app focuses — never a second window).
#[cfg(desktop)]
fn ensure_single_instance(app: &AppHandle) {
    use std::io::{Read, Write};
    let args: Vec<String> = std::env::args().skip(1).collect();
    let link_arg = args.iter().find(|a| is_deep_link(a)).cloned();
    match std::net::TcpListener::bind(("127.0.0.1", SINGLETON_PORT)) {
        Ok(listener) => {
            let handle = app.clone();
            std::thread::spawn(move || {
                for stream in listener.incoming().flatten() {
                    let mut buf = String::new();
                    if stream.take(8192).read_to_string(&mut buf).is_err() {
                        continue;
                    }
                    for line in buf.lines() {
                        match decode_singleton(line) {
                            Some(SingletonMsg::Focus) => focus_main(&handle),
                            Some(SingletonMsg::OpenUrl(url)) => {
                                focus_main(&handle);
                                route_link(&handle, &url);
                            }
                            None => {}
                        }
                    }
                }
            });
        }
        Err(_) => {
            // Windows only lets the process the user just launched take
            // the foreground; hand that right to the running instance
            // so its focus_main actually raises the window.
            #[cfg(target_os = "windows")]
            unsafe {
                use windows::Win32::UI::WindowsAndMessaging::{
                    AllowSetForegroundWindow, ASFW_ANY,
                };
                let _ = AllowSetForegroundWindow(ASFW_ANY);
            }
            if let Ok(mut stream) =
                std::net::TcpStream::connect(("127.0.0.1", SINGLETON_PORT))
            {
                let msg = match link_arg {
                    Some(url) => encode_singleton(&SingletonMsg::OpenUrl(url)),
                    None => encode_singleton(&SingletonMsg::Focus),
                };
                let _ = stream.write_all(msg.as_bytes());
            }
            std::process::exit(0);
        }
    }
}

/// Forward a deep-link process arg (Windows/Linux protocol launch)
/// into the app. Runs at setup; early arrivals also wait in the drain
/// slots for the frontend. macOS delivers links as Apple events
/// instead, through the deep-link plugin's `on_open_url` (lib.rs).
#[cfg(desktop)]
fn handle_startup_args<R: Runtime>(app: &AppHandle<R>) {
    if let Some(arg) = std::env::args().skip(1).find(|a| is_deep_link(a)) {
        route_link(app, &arg);
    }
}

/// OS-global summon chord (⌘/Ctrl⇧Space) as a toggle: show + focus
/// when hidden or behind another app, hide back when ours is focused
/// (macOS activates the previous app, like a Spotlight toggle).
/// Carbon hotkeys need no Accessibility grant (unlike the NSEvent tap
/// this replaced, which also needed `mem::forget` lifetime games and
/// a `block2` closure); a failed registration logs and the in-app
/// chord still works. Desktop only: the plugin crate does not compile
/// for mobile. UNVERIFIED ON DEVICE — no headless harness can press
/// a system-wide chord.
#[cfg(desktop)]
fn install_summon_hotkey(app: &AppHandle) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    let handle = app.clone();
    if let Err(error) = app.global_shortcut().on_shortcut(
        "CommandOrControl+Shift+Space",
        move |_app, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            let Some(window) = handle.get_webview_window("main") else {
                return;
            };
            // Focused gets the toggle half: hide back to the
            // previous app instead of skipping.
            if window.is_focused().unwrap_or(false) {
                let _ = window.hide();
                return;
            }
            if window.is_visible().unwrap_or(true) {
                let _ = window.set_focus();
            } else {
                let _ = window.show();
                let _ = window.set_focus();
            }
        },
    ) {
        eprintln!("[desktop] global summon shortcut unavailable: {error}");
    }
}

/// Capture-any-window OCR chord: fires while another app (game, browser,
/// emulator) is focused and only emits `game-capture` — never shows our
/// window first, so a fullscreen Space stays put for the area flow. The
/// frontend brings the window forward itself on the paths that need it
/// visible (no saved square: `show_main`), then runs the pipeline
/// (saved square, saved source, or frontmost window; OCR; auto-send).
/// The frontend ignores the event while the capture setting is off, so
/// the checkbox reads as a disable. A failed registration logs and the
/// in-app chord still works (same contract as summon). Desktop only:
/// the plugin crate does not compile for mobile. UNVERIFIED ON DEVICE —
/// no headless harness can press a system-wide chord.
#[cfg(target_os = "macos")]
fn install_capture_hotkey(app: &AppHandle) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    if let Err(error) = app.global_shortcut().on_shortcut(
        "CommandOrControl+Shift+O",
        move |app, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            let _ = app.emit("game-capture", ());
        },
    ) {
        eprintln!("[desktop] global capture shortcut unavailable: {error}");
    }
}

/// Set-area chord: only emits `area-pick-requested` — the frontend
/// opens the plain desktop overlay and ignores the event while the
/// capture setting is off, so the checkbox reads as a disable (same
/// contract as the capture chord). Desktop only: the plugin crate
/// does not compile for mobile. UNVERIFIED ON DEVICE — no headless
/// harness can press a system-wide chord.
#[cfg(target_os = "macos")]
fn install_area_hotkey(app: &AppHandle) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    if let Err(error) = app.global_shortcut().on_shortcut(
        "CommandOrControl+Shift+U",
        move |app, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            let _ = app.emit("area-pick-requested", ());
        },
    ) {
        eprintln!("[desktop] global area shortcut unavailable: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(role: &str, content: &str) -> StudyLine {
        StudyLine {
            role: role.into(),
            content: content.into(),
        }
    }

    #[test]
    fn deep_link_path_form() {
        assert_eq!(
            parse_deep_link("ccez://chat/abc123"),
            Some(DeepLinkPayload::open_chat("abc123"))
        );
    }

    #[test]
    fn deep_link_query_form_decodes() {
        assert_eq!(
            parse_deep_link("ccez://chat?id=hello%20world"),
            Some(DeepLinkPayload::open_chat("hello world"))
        );
    }

    #[test]
    fn deep_link_new() {
        assert_eq!(parse_deep_link("ccez://new"), Some(DeepLinkPayload::new_chat()));
    }

    #[test]
    fn deep_link_rejects_foreign_input() {
        for bad in [
            "https://chat/abc",
            "ccez://chat/",
            "ccez://chat",
            "ccez://chat/a/b",
            "ccez://chat/../x",
            "ccez://unknown",
            "ccez://new/extra",
            "",
            "ccez://",
        ] {
            assert_eq!(parse_deep_link(bad), None, "{bad}");
        }
    }

    #[test]
    fn deep_link_current_scheme() {
        assert_eq!(
            parse_deep_link("ccez-llm://chat/abc123"),
            Some(DeepLinkPayload::open_chat("abc123"))
        );
        assert_eq!(parse_deep_link("ccez-llm://new/"), Some(DeepLinkPayload::new_chat()));
        assert!(is_deep_link("ccez-llm://new"));
        assert!(is_deep_link("ccez://new"));
        assert!(!is_deep_link("ccez-llmx://new"));
        assert!(!is_deep_link("--flag"));
    }

    #[test]
    fn deep_link_text_routes() {
        assert_eq!(
            parse_link("ccez-llm://send?text=Bonjour%20%C3%A0%20tous"),
            Some(DeepLink::Text {
                text: "Bonjour à tous".into(),
                action: None
            })
        );
        assert_eq!(
            parse_link("ccez-llm://speak?text=%E6%97%A5%E6%9C%AC%E8%AA%9E"),
            Some(DeepLink::Text {
                text: "日本語".into(),
                action: Some("speak".into())
            })
        );
        assert_eq!(
            parse_link("ccez-llm://annotate?x=1&text=+Hallo+"),
            Some(DeepLink::Text {
                text: "Hallo".into(),
                action: Some("annotate".into())
            })
        );
        // Text links never pose as navigation, and empty text is dropped.
        assert_eq!(parse_deep_link("ccez-llm://send?text=hi"), None);
        assert_eq!(parse_link("ccez-llm://send?text=%20%20"), None);
        assert_eq!(parse_link("ccez-llm://send"), None);
        let long = "a".repeat(5000);
        match parse_link(&format!("ccez-llm://send?text={long}")) {
            Some(DeepLink::Text { text, .. }) => assert_eq!(text.chars().count(), 4000),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn sent_text_prefers_the_selection() {
        let s = |v: &str| Some(v.to_string());
        assert_eq!(pick_sent_text(s(" picked "), s("clip")), s("picked"));
        assert_eq!(pick_sent_text(None, s("clip")), s("clip"));
        assert_eq!(pick_sent_text(s("  "), s("clip")), s("clip"));
        assert_eq!(pick_sent_text(None, None), None);
        assert_eq!(pick_sent_text(None, s("\n")), None);
    }

    #[test]
    fn singleton_roundtrip() {
        for msg in [
            SingletonMsg::Focus,
            SingletonMsg::OpenUrl("ccez://chat/abc".into()),
        ] {
            assert_eq!(decode_singleton(&encode_singleton(&msg)), Some(msg));
        }
        assert_eq!(decode_singleton("quit"), None);
        assert_eq!(decode_singleton("open "), None);
    }

    #[test]
    fn sleep_claims_refcount() {
        let mut claims = SleepClaims::default();
        let a = claims.acquire("speech");
        let b = claims.acquire("stream");
        assert_eq!(claims.count(), 2);
        assert!(claims.release(a));
        assert_eq!(claims.count(), 1);
        assert!(!claims.release(a));
        assert!(claims.release(b));
        assert_eq!(claims.count(), 0);
    }

    #[test]
    fn windows_flags_shape() {
        assert_eq!(windows_sleep_flags(true), 0x8000_0003);
        assert_eq!(windows_sleep_flags(false), 0x8000_0000);
    }

    #[test]
    fn sheet_renders_roles_and_skips_empties() {
        let md = study_sheet_markdown(
            "French verbs",
            &[
                line("user", "Explain être"),
                line("assistant", "Être means to be."),
                line("user", "   "),
            ],
        );
        assert!(md.contains("# French verbs"), "{md}");
        assert!(md.contains("## You\n\nExplain être"), "{md}");
        assert!(md.contains("## Ccez\n\nÊtre means to be."), "{md}");
        assert!(md.contains("2 messages"), "{md}");
    }

    #[test]
    fn sheet_blank_title_and_truncation() {
        let md = study_sheet_markdown("   ", &[line("user", "hi")]);
        assert!(md.contains("# Untitled chat"), "{md}");
        let big = "x".repeat(MAX_SHEET_CHARS + 10);
        let md = study_sheet_markdown("t", &[line("user", &big)]);
        assert!(md.len() <= MAX_SHEET_CHARS + 100, "{}", md.len());
        assert!(md.contains("truncated"), "{md}");
    }

    #[test]
    fn file_stem_sanitizes() {
        assert_eq!(sanitize_file_stem("French verbs: être!"), "french-verbs-tre");
        assert_eq!(sanitize_file_stem("???"), "chat");
        assert_eq!(sanitize_file_stem("  spaced  out  "), "spaced-out");
    }

    #[test]
    fn percent_decode_shapes() {
        assert_eq!(percent_decode("a%20b+c"), "a b c");
        assert_eq!(percent_decode("a%2Fx"), "a/x");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz%4"), "%zz%4");
        assert_eq!(percent_decode("caf%C3%A9"), "café");
        assert_eq!(percent_decode("bad%FF"), "bad\u{FFFD}");
    }
}
