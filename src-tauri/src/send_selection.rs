//! Windows "send text to Ccez LLM": the desktop counterpart of
//! Android's share target and PROCESS_TEXT actions. NSIS installs carry
//! no package identity, so the Windows Share sheet cannot list the app
//! (share targets need MSIX); a global chord does the job instead.
//!
//! Ctrl+Alt+Space in any app: wait for the chord's keys to come up,
//! synthesize Ctrl+C, read what the foreground app copied, put the
//! user's previous clipboard text back, then show the window and
//! prefill the composer through the same `annotate-external` path
//! Android shares use. No selection: the current clipboard text goes
//! instead (`desktop::pick_sent_text`). UNVERIFIED headless: exercised
//! by hand in the Windows test VM (docs/platforms/windows.md).

use std::time::{Duration, Instant};

use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;
use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
    KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT, VK_SPACE,
};

/// Global chord (tauri-plugin-global-shortcut syntax).
pub const SEND_SELECTION_SHORTCUT: &str = "Control+Alt+Space";

const VK_C: VIRTUAL_KEY = VIRTUAL_KEY(0x43);
const VK_MENU_MASK: VIRTUAL_KEY = VIRTUAL_KEY(0xE8);

pub fn install(app: &AppHandle) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    let result = app.global_shortcut().on_shortcut(
        SEND_SELECTION_SHORTCUT,
        |app, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            // Now, while Alt is still held: the hotkey swallows the
            // Space, so releasing Alt would read as a lone Alt tap and
            // open the foreground app's menu bar, which then eats the
            // Ctrl+C. Seen in the test VM with Notepad.
            mask_alt_release();
            // Off the event loop: the copy waits on other apps.
            let app = app.clone();
            std::thread::spawn(move || send(&app));
        },
    );
    if let Err(error) = result {
        eprintln!("[send-selection] global shortcut unavailable: {error}");
    }
}

fn send(app: &AppHandle) {
    wait_for_keys_up(Duration::from_millis(1500));
    let before = app.clipboard().read_text().ok();
    let seq = unsafe { GetClipboardSequenceNumber() };
    press_ctrl_c();
    let changed = wait_for_clipboard_change(seq, Duration::from_millis(700));
    let copied = if changed {
        app.clipboard().read_text().ok()
    } else {
        None
    };
    if changed {
        // Give the user's clipboard back (text only: an image or file
        // list the copy replaced cannot be restored through this API).
        if let Some(previous) = before.clone() {
            let _ = app.clipboard().write_text(previous);
        }
    }
    let text = crate::desktop::pick_sent_text(copied, before);
    crate::desktop::focus_main(app);
    if let Some(text) = text {
        crate::annotate::emit(Some(text), None);
    }
}

fn key_down(vk: VIRTUAL_KEY) -> bool {
    (unsafe { GetAsyncKeyState(vk.0 as i32) } as u16 & 0x8000) != 0
}

/// The chord's own modifiers would turn our Ctrl+C into Ctrl+Alt+C.
fn wait_for_keys_up(limit: Duration) {
    let start = Instant::now();
    let keys = [VK_CONTROL, VK_MENU, VK_SHIFT, VK_SPACE, VK_LWIN, VK_RWIN];
    while keys.iter().any(|&k| key_down(k)) && start.elapsed() < limit {
        std::thread::sleep(Duration::from_millis(15));
    }
}

/// Tap an unassigned virtual key (vkE8, AutoHotkey's menu-mask key)
/// so Windows sees Alt combined with something and skips menu
/// activation on release. Apps ignore the key itself.
fn mask_alt_release() {
    send_keys(&[(VK_MENU_MASK, KEYBD_EVENT_FLAGS(0)), (VK_MENU_MASK, KEYEVENTF_KEYUP)]);
}

fn press_ctrl_c() {
    let none = KEYBD_EVENT_FLAGS(0);
    send_keys(&[
        (VK_CONTROL, none),
        (VK_C, none),
        (VK_C, KEYEVENTF_KEYUP),
        (VK_CONTROL, KEYEVENTF_KEYUP),
    ]);
}

fn send_keys(keys: &[(VIRTUAL_KEY, KEYBD_EVENT_FLAGS)]) {
    let inputs: Vec<INPUT> = keys
        .iter()
        .map(|&(vk, flags)| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        })
        .collect();
    unsafe {
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

fn wait_for_clipboard_change(seq: u32, limit: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < limit {
        if unsafe { GetClipboardSequenceNumber() } != seq {
            // Let the owner finish writing every format.
            std::thread::sleep(Duration::from_millis(40));
            return true;
        }
        std::thread::sleep(Duration::from_millis(15));
    }
    false
}
