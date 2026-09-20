// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

#[cfg(all(target_os = "macos", debug_assertions))]
mod dev_icon;
mod annotate;
mod coderun;
#[cfg(desktop)]
mod desktop;
mod dictation;
mod fetch;
mod ocr;
#[cfg(target_os = "windows")]
mod ocr_windows;
#[cfg(target_os = "linux")]
mod ocr_linux;
mod dictate_linux;
mod dictate_macos;
mod dictate_windows;
mod keyboard;
mod langid;
mod ondevice;
#[cfg(desktop)]
mod menu;
#[cfg(target_os = "macos")]
mod trafficlights;
mod tts;
#[cfg(target_os = "android")]
mod tts_android;
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

/// Read a secret; `None` when nothing is stored under `account`.
#[tauri::command]
fn keychain_get(account: String) -> Result<Option<String>, String> {
    #[cfg(target_os = "android")]
    return secrets_android::get(KEYCHAIN_SERVICE, &account);
    #[cfg(not(target_os = "android"))]
    {
        let entry =
            keyring::Entry::new(KEYCHAIN_SERVICE, &account).map_err(|e| e.to_string())?;
        match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
}

/// Write (create or replace) a secret.
#[tauri::command]
fn keychain_set(account: String, secret: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return secrets_android::set(KEYCHAIN_SERVICE, &account, &secret);
    #[cfg(not(target_os = "android"))]
    {
        let entry =
            keyring::Entry::new(KEYCHAIN_SERVICE, &account).map_err(|e| e.to_string())?;
        entry.set_password(&secret).map_err(|e| e.to_string())
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

/// Delete a secret; missing entries are not an error.
#[tauri::command]
fn keychain_delete(account: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return secrets_android::delete(KEYCHAIN_SERVICE, &account);
    #[cfg(not(target_os = "android"))]
    {
        let entry =
            keyring::Entry::new(KEYCHAIN_SERVICE, &account).map_err(|e| e.to_string())?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_haptics::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init());
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
            #[cfg(desktop)]
            desktop::desktop_drain_pending_link,
            keychain_get,
            keychain_set,
            keychain_delete,
            open_voice_settings,
            keyboard::current_input_source,
            tts::tts_supported,
            tts::tts_speak,
            tts::tts_stop,
            tts::tts_save_speech,
            tts::tts_voices,
            tts::tts_identify_lang,
            ocr::ocr_supported,
            ocr::ocr_recognize,
            dictate_start,
            dictate_stop,
            coderun::run_code,
            fetch::fetch_page,
            ondevice::ondevice_status,
            ondevice::ondevice_generate,
            update_android::update_download_apk,
            update_android::update_install_apk
        ])
        .setup(|_app| {
            // External-text bridge (Android PROCESS_TEXT / action-mode):
            // capture the handle before any intent can fire the native fns.
            annotate::remember(_app.handle());
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
            // Native menu bar (desktop only; mobile has no menu bar).
            #[cfg(desktop)]
            _app.set_menu(menu::build(_app.handle())?)?;
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
