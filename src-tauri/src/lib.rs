// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

#[cfg(all(target_os = "macos", debug_assertions))]
mod dev_icon;
// iOS keeps keys in the Keychain even in debug builds: the dev key file
// lives at a path baked in from the build host, which a phone (or a CI
// Simulator) cannot rely on.
#[cfg(all(debug_assertions, not(any(target_os = "android", target_os = "ios"))))]
mod dev_secrets;
mod annotate;
mod capture;
mod coderun;
mod game_line;
// Deep-link parsing, routing and the pending-link drain serve every
// platform (iOS/Android open URLs too); the summon kit, tray and sleep
// guards inside stay `#[cfg(desktop)]`.
mod desktop;
mod dictation;
mod fetch;
mod news;
mod ocr;
mod og_image;
mod page_text;
#[cfg(target_os = "windows")]
mod ocr_windows;
#[cfg(target_os = "windows")]
mod send_selection;
#[cfg(target_os = "linux")]
mod ocr_linux;
mod dictate_linux;
mod dictate_macos;
mod dictate_windows;
mod keyboard;
mod langid;
#[cfg(desktop)]
mod listen;
mod models;
mod ondevice;
#[cfg(desktop)]
mod menu;
#[cfg(target_os = "macos")]
mod trafficlights;
mod tts;
#[cfg(target_os = "android")]
mod tts_android;
mod promptmenu;
mod turn;
#[cfg(target_os = "android")]
mod turn_service;
mod update_android;
mod tts_linux;
mod tts_windows;
#[cfg(target_os = "android")]
mod secrets_android;

/// Native dictation fallback for platforms without an implementation
/// (iOS and the remaining stubs): the frontend falls back to Web
/// Speech on invoke failure.
#[cfg(not(any(
    target_os = "android",
    target_os = "macos",
    target_os = "windows",
    target_os = "linux"
)))]
mod dictate_unsupported {
    #[tauri::command]
    pub fn dictate_start(_app: tauri::AppHandle, _lang: Option<String>) -> Result<(), String> {
        Err("native dictation is not supported on this platform".into())
    }

    #[tauri::command]
    pub fn dictate_stop() -> Result<(), String> {
        Ok(())
    }
}

// Exactly one dictate_start/dictate_stop pair registers per platform:
// real implementations on Android/macOS/Windows/Linux, Err stubs
// elsewhere.
#[cfg(target_os = "android")]
use dictation::{dictate_start, dictate_stop};
#[cfg(target_os = "macos")]
use dictate_macos::{dictate_start, dictate_stop};
#[cfg(target_os = "windows")]
use dictate_windows::{dictate_start, dictate_stop};
#[cfg(target_os = "linux")]
use dictate_linux::{dictate_start, dictate_stop};
#[cfg(not(any(
    target_os = "android",
    target_os = "macos",
    target_os = "windows",
    target_os = "linux"
)))]
use dictate_unsupported::{dictate_start, dictate_stop};

/// API-key storage: macOS Keychain / iOS keychain, Windows Credential
/// Manager, and the Linux Secret Service (GNOME Keyring / KWallet) all
/// via the `keyring` crate (`apple-native`, `windows-native`, and
/// `sync-secret-service` features in `Cargo.toml`); Android Keystore
/// via `secrets_android` (keyring has no Android backend — it falls
/// back to an in-memory mock). Service name matches the Tauri bundle
/// identifier (`identifier` in `tauri.conf.json`, mirrored as
/// `KEYCHAIN_SERVICE` in `src/lib/secrets.ts` — a Vitest
/// identity-stability test locks all three together). Keep it frozen:
/// renaming orphans every stored key, the same mass re-prompt symptom
/// as the dev-rebuild issue below.
///
/// Dev-rebuild re-prompt: ad-hoc-signed dev binaries change code
/// identity every rebuild, so the Keychain ACL re-prompts. Sign the
/// dev binary with the persistent local self-signed "Ccez Dev"
/// code-signing cert instead (Keychain Access -> Certificate
/// Assistant, then `codesign -s "Ccez Dev" <dev binary>`); that
/// identity lives only on the dev machine and is never committed.
/// Confirming the re-prompt is gone needs a real Mac rebuild cycle.
const KEYCHAIN_SERVICE: &str = "studio.ccez.app";

/// Keychain answers for this process: each account is read from the
/// OS at most once per launch, and writes/deletes update the memo. On
/// macOS every read of an item this exact binary isn't granted shows a
/// password dialog (a self-signed dev build is re-identified by content
/// hash on every rebuild), and webview reloads or provider retries used
/// to re-read — one dialog after another. A denied read is remembered
/// too, so dismissing the dialog never summons it again this launch.
#[cfg(not(target_os = "android"))]
type KeychainRead = Result<Option<String>, String>;
#[cfg(not(target_os = "android"))]
static KEYCHAIN_MEMO: std::sync::Mutex<Option<std::collections::HashMap<String, KeychainRead>>> =
    std::sync::Mutex::new(None);

#[cfg(not(target_os = "android"))]
fn memo_get(account: &str) -> Option<KeychainRead> {
    let guard = KEYCHAIN_MEMO.lock().ok()?;
    guard.as_ref()?.get(account).cloned()
}

#[cfg(not(target_os = "android"))]
fn memo_put(account: &str, value: KeychainRead) {
    if let Ok(mut guard) = KEYCHAIN_MEMO.lock() {
        guard
            .get_or_insert_with(Default::default)
            .insert(account.to_string(), value);
    }
}

/// Read a secret; `None` when nothing is stored under `account`.
#[tauri::command]
fn keychain_get(account: String) -> Result<Option<String>, String> {
    #[cfg(target_os = "android")]
    return secrets_android::get(KEYCHAIN_SERVICE, &account);
    #[cfg(not(target_os = "android"))]
    {
        // Dev builds: the gitignored key file answers first (see
        // dev_secrets); only a key it has never seen reads the
        // Keychain, once, and is copied into the file.
        #[cfg(all(debug_assertions, not(target_os = "ios")))]
        if let Some(known) = dev_secrets::lookup(&dev_secrets::store_path(), &account) {
            return Ok(known);
        }
        if let Some(known) = memo_get(&account) {
            return known;
        }
        let entry =
            keyring::Entry::new(KEYCHAIN_SERVICE, &account).map_err(|e| e.to_string())?;
        let read = match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        };
        #[cfg(all(debug_assertions, not(target_os = "ios")))]
        if let Ok(Some(secret)) = &read {
            let _ = dev_secrets::record(&dev_secrets::store_path(), &account, Some(secret.clone()));
        }
        memo_put(&account, read.clone());
        read
    }
}

/// Write (create or replace) a secret.
#[tauri::command]
fn keychain_set(account: String, secret: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return secrets_android::set(KEYCHAIN_SERVICE, &account, &secret);
    #[cfg(not(target_os = "android"))]
    {
        // Dev builds write the key file only: a Keychain write from a
        // rebuilt dev binary asks for the password too.
        #[cfg(all(debug_assertions, not(target_os = "ios")))]
        return dev_secrets::record(&dev_secrets::store_path(), &account, Some(secret));
        #[cfg(any(not(debug_assertions), target_os = "ios"))]
        {
            let entry =
                keyring::Entry::new(KEYCHAIN_SERVICE, &account).map_err(|e| e.to_string())?;
            entry.set_password(&secret).map_err(|e| e.to_string())?;
            memo_put(&account, Ok(Some(secret)));
            Ok(())
        }
    }
}

/// Open the OS voice-download settings: macOS System Settings at the
/// Accessibility pane, where voice downloads live (Read & Speak → System
/// Voice → Manage Voices); Windows Speech settings (Time & language →
/// Speech → Manage voices); Android text-to-speech settings. macOS uses
/// the `open` CLI directly: no plugin scope to misconfigure, and opening
/// Settings needs no user permission. No public Apple API goes deeper
/// (sub-anchors are swallowed), so the UI always prints the in-pane path
/// alongside.
#[tauri::command]
fn open_voice_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        const URL: &str = "x-apple.systempreferences:com.apple.preference.universalaccess";
        let status = std::process::Command::new("open")
            .arg(URL)
            .status()
            .map_err(|e| e.to_string())?;
        return if status.success() {
            Ok(())
        } else {
            Err("System Settings did not open".into())
        };
    }
    #[cfg(target_os = "windows")]
    {
        // Speech settings page (Manage voices lives there). `start`
        // needs the empty title arg: the first quoted arg is a window
        // title, not the target.
        let status = std::process::Command::new("cmd")
            .args(["/C", "start", "", "ms-settings:speech"])
            .status()
            .map_err(|e| e.to_string())?;
        return if status.success() {
            Ok(())
        } else {
            Err("Speech settings did not open".into())
        };
    }
    #[cfg(target_os = "android")]
    {
        return tts_android::open_tts_settings();
    }
    #[cfg(not(any(
        target_os = "macos",
        target_os = "windows",
        target_os = "android"
    )))]
    {
        return Err("opening System Settings requires macOS".into());
    }
}

/// Open the OS screen-capture privacy settings: macOS System Settings
/// at the Privacy & Security pane, where the Screen Recording row
/// lives; Windows has no per-app capture toggle page, so that arm
/// declines and the caller keeps the plain toast. macOS uses the
/// `open` CLI directly like `open_voice_settings` (no plugin scope
/// to misconfigure, no permission needed). No public Apple API goes
/// deeper (sub-anchors are swallowed), so the toast copy always
/// prints the in-pane row alongside.
#[tauri::command]
fn open_screen_recording_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        const URL: &str =
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
        let status = std::process::Command::new("open")
            .arg(URL)
            .status()
            .map_err(|e| e.to_string())?;
        return if status.success() {
            Ok(())
        } else {
            Err("System Settings did not open".into())
        };
    }
    #[cfg(not(target_os = "macos"))]
    {
        return Err("screen capture settings need macOS System Settings".into());
    }
}

/// Delete a secret; missing entries are not an error.
#[tauri::command]
fn keychain_delete(account: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return secrets_android::delete(KEYCHAIN_SERVICE, &account);
    #[cfg(not(target_os = "android"))]
    {
        // Dev builds: remember the deletion in the key file (its null
        // keeps the old Keychain copy from coming back).
        #[cfg(all(debug_assertions, not(target_os = "ios")))]
        return dev_secrets::record(&dev_secrets::store_path(), &account, None);
        #[cfg(any(not(debug_assertions), target_os = "ios"))]
        let entry =
            keyring::Entry::new(KEYCHAIN_SERVICE, &account).map_err(|e| e.to_string())?;
        #[cfg(any(not(debug_assertions), target_os = "ios"))]
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {
                memo_put(&account, Ok(None));
                Ok(())
            }
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(all(test, not(target_os = "android")))]
mod keychain_memo_tests {
    use super::{memo_get, memo_put};

    #[test]
    fn remembers_reads_writes_and_denials() {
        assert!(memo_get("test:memo-a").is_none());
        memo_put("test:memo-a", Ok(Some("k".into())));
        assert_eq!(memo_get("test:memo-a"), Some(Ok(Some("k".into()))));
        memo_put("test:memo-a", Ok(None));
        assert_eq!(memo_get("test:memo-a"), Some(Ok(None)));
        memo_put("test:memo-b", Err("denied".into()));
        assert_eq!(memo_get("test:memo-b"), Some(Err("denied".into())));
    }
}

/// Install a default TLS crypto provider (ring). Tauri core's mobile-dev
/// protocol handler builds a reqwest client to proxy the dev server and
/// `build().unwrap()`s it; reqwest 0.13 panics without a provider even for
/// plain HTTP, and core only installs one on its HTTPS path. Without this
/// the app SIGABRTs ~2s after launch on Android dev builds.
fn install_tls_provider() {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_tls_provider();
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_haptics::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        // OS URL-scheme registration (`ccez-llm://`, see desktop.rs):
        // the bundler writes it from `plugins.deep-link` in
        // tauri.conf.json (NSIS registry keys, macOS/iOS URL types,
        // Android intent filters).
        .plugin(tauri_plugin_deep_link::init());
    // Remembered window size, position and maximized state (desktop).
    // Visibility stays out so a launch never opens hidden; the overlay
    // windows (area picker, game line) size themselves.
    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_window_state::Builder::new()
            .with_state_flags(
                tauri_plugin_window_state::StateFlags::all()
                    - tauri_plugin_window_state::StateFlags::VISIBLE
                    - tauri_plugin_window_state::StateFlags::DECORATIONS,
            )
            .with_denylist(&["area-pick", "game-line"])
            .build(),
    );
    // Global summon chord (desktop only — the plugin crate does not
    // compile for mobile; same shape as the on_menu_event link below).
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());
    // MCP automation bridge (debug builds only — the WebSocket it
    // opens must never ship, so release builds skip registration
    // entirely; localhost bind, never the default all-interfaces).
    // Lets an MCP driver session inspect the running app (screenshots,
    // DOM, console) while debugging UI reports.
    #[cfg(all(debug_assertions, desktop))]
    let builder = builder.plugin(
        tauri_plugin_mcp_bridge::Builder::new()
            .bind_address("127.0.0.1")
            .build(),
    );
    let builder = builder
        .invoke_handler(tauri::generate_handler![
            annotate::drain_pending_external,
            #[cfg(desktop)]
            desktop::desktop_sleep_block,
            #[cfg(desktop)]
            desktop::desktop_sleep_unblock,
            #[cfg(desktop)]
            desktop::desktop_export_study_sheet,
            desktop::desktop_drain_pending_link,
            #[cfg(desktop)]
            listen::listen_search,
            #[cfg(desktop)]
            listen::listen_channel,
            #[cfg(desktop)]
            listen::listen_videos,
            #[cfg(desktop)]
            listen::listen_fetch,
            #[cfg(desktop)]
            listen::listen_audio,
            keychain_get,
            keychain_set,
            models::list_models,
            keychain_delete,
            open_voice_settings,
            open_screen_recording_settings,
            keyboard::current_input_source,
            tts::tts_supported,
            tts::tts_speak,
            tts::tts_stop,
            tts::tts_save_speech,
            tts::tts_voices,
            tts::tts_identify_lang,
            ocr::ocr_supported,
            ocr::ocr_recognize,
            capture::capture_supported,
            capture::list_windows,
            capture::capture_window,
            capture::capture_interactive,
            capture::capture_rect,
            capture::open_area_picker,
            capture::submit_area_rect,
            capture::show_main,
            game_line::open_game_line,
            game_line::close_game_line,
            dictate_start,
            dictate_stop,
            coderun::run_code,
            fetch::fetch_page,
            news::news_decode_url,
            og_image::fetch_og_image,
            promptmenu::set_prompt_menu_allowed,
            turn::turn_start,
            turn::turn_poll,
            turn::turn_scan,
            turn::turn_stop,
            turn::turn_seen,
            turn::turn_dismiss,
            turn::turn_drain_pending_chat,
            ondevice::ondevice_status,
            ondevice::ondevice_generate,
            ondevice::ondevice_open_aicore_page,
            update_android::update_download_apk,
            update_android::update_install_apk
        ])
        .setup(|_app| {
            // External-text bridge (Android PROCESS_TEXT / action-mode):
            // capture the handle before any intent can fire the native fns.
            annotate::remember(_app.handle());
            // Notice-tap bridge (Android turn notice): same capture so
            // taps emit live or park for the frontend drain.
            turn::remember_open_chat(_app.handle());
            // Dev-only: shrink the oversized runtime Dock tile (see dev_icon).
            #[cfg(all(target_os = "macos", debug_assertions))]
            if let Some(window) = tauri::Manager::get_webview_window(_app.handle(), "main") {
                dev_icon::watch(window);
            }
            // Hover-reveal traffic lights (macOS overlay titlebar).
            #[cfg(target_os = "macos")]
            if let Some(window) = tauri::Manager::get_webview_window(_app.handle(), "main") {
                trafficlights::watch(window);
            }
            // Native menu bar on macOS and Linux. Windows gets none: an
            // in-window menu strip would restyle the app, and every
            // item has an in-app key or control already.
            #[cfg(all(desktop, not(target_os = "windows")))]
            _app.set_menu(menu::build(_app.handle())?)?;
            // OS-delivered links (Apple events on macOS/iOS, intents on
            // Android). Windows/Linux get links as launch args instead,
            // handled by the singleton in desktop.rs.
            #[cfg(not(any(target_os = "windows", target_os = "linux")))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = _app.handle().clone();
                _app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        desktop::route_link(&handle, url.as_str());
                    }
                });
            }
            // Dev builds run unbundled, so nothing registered the
            // scheme: register it for this user (installers own it in
            // release builds, and their uninstallers remove it).
            #[cfg(all(debug_assertions, any(target_os = "windows", target_os = "linux")))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = _app.deep_link().register_all();
            }
            // Summon kit: tray, single instance, global hotkey, deep links.
            #[cfg(desktop)]
            desktop::wire(_app.handle())?;
            Ok(())
        });
    // App-menu clicks, desktop only: mobile has no menu bar, and
    // Builder::on_menu_event itself is desktop-gated in Tauri 2.11.
    #[cfg(desktop)]
    let builder = builder.on_menu_event(|app, event| {
        menu::forward(app, event.id().as_ref());
    });
    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
