# Browser pane

A web browser beside the chat on desktop (owner, 2026-11-04), as the
Claude desktop app has one. The first try (Sept 2026, a second webview
opened by Cmd+T, removed on the 15th) felt bad: one tab, a fixed width,
no drag, no page title or loading, menus hidden behind the page, its
specs never run. This is the list it is held to. Every item is checked
on the real Mac app (scripts/drive.ts) before it ships.

## How it's built

- Each tab is a native child webview of the main window (WKWebView on
  Mac, WebView2 on Windows, WebKitGTK on Linux), added by Rust
  (`browser.rs`). The tab strip, address bar and the divider are the
  app's own HTML; the page fills a placeholder box the app measures.
- Native views always draw above the app's HTML. So anything of the
  app's that would sit over the page (a menu, a toast, Settings, a
  word card) makes the page step aside: a still snapshot of it takes
  its place until the overlay goes.
- The pages get none of the app's powers: no Tauri commands (remote
  origins have no capability), their own data store (cookies and
  storage apart from the app's chats and keys).
- Desktop only. Phones, the web build and plain browsers have no pane.

## The checklist

Ticked: checked on the Mac app through scripts/drive.ts (screenshots
with the page composited in) or by e2e/browser-pane.e2e.ts. Unticked:
needs real keys, clicks or the network in a way the drive bridge can't
give without taking the owner's focus (a native click in the page, menu
keys while the page has the keyboard, video full screen, downloads).

### Opening and closing

- [x] A toolbar button opens and closes it, and ⌘⇧B (the menu's View → Browser); it remembers whether it was open.
- [x] Opening it puts the cursor in the address bar of a new tab; reopening shows the tabs as they were.
- [x] Closing the last tab closes the pane; closing the pane keeps its tabs for next time.
- [x] Tabs, the active tab, the width and expanded state survive a relaunch.
- [x] Links in chat replies open in the pane while it's open (⌘-click: a new tab), in the system browser when it's closed.

### The split

- [x] A divider between the chat and the pane: a thin line, a wide grab area (8px), the resize cursor, a highlight on hover and while dragging.
- [x] Dragging is smooth: the page doesn't tear or lag behind the divider (its snapshot stands in while dragging; the room past it takes the page's own background colour).
- [x] The chat keeps at least 320px, the pane at least 360px; a window too narrow for both shows the pane expanded with a way back.
- [x] Double-click on the divider puts it back at half.
- [x] The width is remembered as a share of the window, so a bigger window gives both more.
- [x] Expand: the pane takes the whole window (chat hidden), the same button or ⌘⇧E takes it back.
- [ ] The chat column re-centres in its narrower room; the prompt and the chat list keep working.
- [ ] Resizing the window: the page keeps up (no gap at its edge, no stale size after).

### Tabs

- [x] A strip of tabs: favicon, title, × on the active tab and on hover; a + at the end.
- [x] Many tabs shrink to a minimum width, then the strip scrolls sideways; the active tab is kept in view.
- [x] A loading tab spins where its favicon goes.
- [x] Middle-click closes a tab; dragging reorders tabs.
- [ ] ⌘T new tab, ⌘W close tab (only while the pane has focus or is the last thing used), ⌃Tab / ⌃⇧Tab next and previous, ⌘1…⌘9 when the pane has focus.
- [x] A link that opens a new window (target=_blank, window.open) opens a new tab beside its tab.
- [x] Closing a tab activates its neighbour (the right one, else the left).

### Address bar

- [ ] Back, forward, reload (stop while loading); back and forward greyed when there's nowhere to go.
- [x] The URL shown plainly (the host darker), the whole URL while editing; a click selects it all.
- [x] Enter goes: a URL as typed (https added), anything else searched (DuckDuckGo).
- [ ] Esc while editing puts the URL back and gives the page focus.
- [ ] ⌘L (or the address bar click) focuses it from anywhere in the pane.
- [ ] The URL follows the page as it changes, single-page sites (YouTube) too.
- [x] A thin progress line while a page loads.
- [x] Plain http shows "Not secure"; a page that fails to load says so with Try again.

### Focus and keys

- [ ] Clicking the page gives it the keyboard; clicking the chat gives it back. The app's own keys never fire while you type in a page.
- [ ] While the page has focus: ⌘T, ⌘W, ⌘L, ⌘R, ⌘[ ⌘], ⌘= ⌘- ⌘0 (the page's zoom, not the app's text size), ⌘F find in page, ⌘, Settings still work (menu keys).
- [ ] Esc in a page goes to the page (videos leave full screen, dialogs close), never closes the pane.
- [ ] Double-click, drags and swipes in the page do the page's thing: never open Settings or the chat list (the right-gutter double-click is off while the pane is open: the right side is the page).
- [ ] The app's shortcuts that open things over the window (Settings, shortcuts, search) step the page aside instead of drawing under it.

### Overlays (native page over HTML)

- [x] Settings, the shortcuts list, licenses, search palette, flashcards, reader: the page steps aside (its snapshot under the veil).
- [ ] Toasts and banners sit over the chat, not under the page.
- [x] Menus and word cards that reach past the divider: the page steps aside while they're open.
- [ ] Nothing of the app's is ever hidden under the page.

### Pages

- [x] Pages get their own cookies and storage (logins kept between launches), apart from the app's.
- [ ] Downloads save to Downloads and say so.
- [x] Dark pages and light pages both look right next to the app in both themes (the pane's chrome follows the app).
- [ ] Video full screen from a page fills the pane (or the window), and Esc brings it back.
- [ ] The page's own right-click menu.
- [ ] A page that asks for the camera, microphone or location: refused quietly.

### Never

- [ ] Never a flash of white when opening a tab in dark mode.
- [ ] Never two panes, never a page at a stale size or place, never a page left behind after its tab closed.
- [x] Never the app's keys or commands reachable from a page.
- [x] Never on phones or the web build.

## Found while building (fixed)

- With a page in it, the main window isn't a "webview window" to Tauri
  any more: every `get_webview_window("main")` came back empty (the
  tray, the global hotkey, capture, link routing). They use
  `get_window("main")` now.
- The first frame, before the room was measured, read as "too narrow"
  and laid the pane over the whole window; its page was made there.
- Expanded, the pane left the flow, the room doubled, it un-expanded,
  and it flipped every frame (a window too narrow for both). The room
  is measured from the chat's left edge to the window's right now.
- A middle-click on a tab closed it and also opened the shortcuts list;
  a drag on a tab near the window's edge read as an edge stroke for
  Settings.
- A tooltip at rest (transparent, still sized) counted as covering the
  page, so the page hid for good; floaters count only when visible,
  and over an expanded pane only when stacked above it.
- Background tabs spun forever (no page made yet); the blank tab showed
  Stop; switching from the blank tab left the address bar editing; the
  field kept text typed before under the shown URL.
- App Transport Security stopped plain-http pages loading at all; a
  load that never ends (a bad address) fails after 15 s with Try again.
- The MCP bridge's execute_js never answers (it waits on an event that
  doesn't reach it); scripts/drive.ts asks the page through an event
  the bridge emits from Rust and reads a debug-only command's answer.
