# Web deploy (Cloudflare Pages + llm.ccez.uk)

The web build is the same SvelteKit app as the desktop shell, compiled to a
static site. Every Tauri bridge is runtime-guarded (`tauriBackendAvailable()`),
so with no `__TAURI_INTERNALS__` global the app runs shell-free: no Keychain
invoke, no native TTS bridge, no auto-updater.

## Build

```sh
bun run build:web   # == vite build; adapter-static writes ./build
```

- Output directory: `build/` (adapter-static with `fallback: "index.html"`, SPA mode; `ssr = false` in `src/routes/+layout.ts`).
- The app is a single route, so every URL is `/` — no redirect rules needed.
- `bun run preview` serves the production build locally for a smoke check.

## Web equivalents (no Tauri bridge)

| Desktop (Tauri)                                              | Web                                                                                                                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| macOS Keychain via `keychain_*` invokes                      | AES-GCM-256 encrypted localStorage (`src/lib/secrets.ts`); non-extractable key in IndexedDB, ephemeral in-memory key where IndexedDB is missing, legacy plaintext entries still read and re-encrypt on write |
| Native `AVSpeechSynthesizer` bridge (`src/lib/nativeTts.ts`) | Web Speech `speechSynthesis` (`src/lib/voice.ts`); the native probe fails cleanly off-shell and settings fall back to `web`                                                                                  |
| Tauri auto-updater (`@tauri-apps/plugin-updater`)            | Disabled: `updateRouteFor()` returns `{ kind: "none" }` off-shell and the settings panel shows "updates with the site" instead of a check button                                                             |
| `getCurrentWindow()` drag/zoom, menu-action events           | Guarded no-ops off-shell (`src/routes/+page.svelte`)                                                                                                                                                         |

## Cloudflare Pages setup

1. Dashboard → Workers & Pages → Create → Pages → connect the repo.
2. Build configuration: framework preset **SvelteKit**, build command
   `bun run build:web` (or `npm run build:web`), output directory `build`.
   Environment: no secrets needed — the app is BYOK, keys stay in the visitor's browser.
3. First deploy: verify `/`, `/manifest.webmanifest`, and `index.html` fallback load.

## Custom domain (llm.ccez.uk)

Live: https://llm.ccez.uk (Pages project `personalized-llm-client`,
production branch `main`). The old `llm.cstraka.dev` hostname was retired
2026-10-02 when the domain moved to ccez.uk.

1. Pages project → Custom domains → Set up a custom domain → enter
   `llm.ccez.uk`.
2. Cloudflare manages the zone's DNS, so Pages adds the CNAME
   (`llm` → `<project>.pages.dev`, proxied) automatically.
3. TLS is issued automatically; HTTPS is enforced in the zone's SSL/TLS settings.
4. Re-verify after cutover: `https://llm.ccez.uk/` loads the app and the PWA
   manifest at `https://llm.ccez.uk/manifest.webmanifest` resolves.

## PWA status

`static/manifest.webmanifest` + meta in `src/app.html` reference the existing
`favicon.png` (512×512) and `favicon.ico`. No service worker yet, so the app is
installable-bookmarkable but not offline-capable. The full 192/512 maskable icon
cut is a separate later task — do not improvise resized icons here.
