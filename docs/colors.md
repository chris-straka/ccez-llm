# Color system

> Status: **living doc** — update it with every palette change (same commit
> when the change is small). Newest entries go on top of the log.

## The token system (what it is)

Colors are never written where they are used. Every color lives in one
place — `src/app.css`, on the `:root` / `html[data-theme="light"]` /
`html[data-theme="dark"]` blocks — as a named **custom property**
(a "token"), e.g. `--danger: #94250a`. Components reference the name:

```css
color: #94250a; /* fallback: first paint before vars resolve */
color: var(--danger); /* real value, resolved per theme */
```

The double line is convention: the raw hex paints first, then the
variable wins. Doing it this way buys three things:

1. **One source of truth.** A red used in four places is spelled once.
   The delete-draft hover once hardcoded `#ff453a` while Clear-all used
   `var(--danger)` — same intent, two reds, and nobody noticed until a
   human eye caught it.
2. **Theming for free.** A rule like `.toast.error { background:
var(--error-bg); }` needs no `html[data-theme="dark"]` override
   block — the token already resolves per theme. Deleting override
   blocks is the visible payoff of each migration.
3. **Testable contrast.** Every semantic color ships as a pair (ink on
   a surface, per theme), so e2e can pin both sides. See "Pinning".

## Why not Apple HIG values (cross-platform note)

This app ships on macOS, Android, and Windows. Vendor ramps (Apple's
`#007aff`, Material's `#6750A4`, Fluent's `#4CC2FF`) are tuned for
their own scenes and would look borrowed everywhere else — and three
platforms can't share one vendor's identity. So the palette is
**platform-neutral by rule**:

- One accent blue both themes (`--accent`: `#007aff` light for
  familiarity, `#0a84ff` dark for contrast on dark surfaces). The old
  sin was never "blue" — it was _four_ blues (`#007aff`, `#5a9bf7`,
  `#0a84ff`, plus an indigo selection tint).
- Semantic colors picked for role clarity and contrast, not vendor
  identity: `--ok` green, `--alarm` signal red, `--danger` deep red.
- Grays stay the neutral ramp already in use (`--muted`, `--line`,
  `--line-soft`, `--line-hover`).
- Primary actions (send, save, settings selections) use the accent
  fill on light and the **inverted** fill on dark (light button, dark
  glyph) — a deliberate idiom, not an accident. Whether dark actions
  should go accent-filled instead is an open question (owner call).

## The palette (roles, not hues)

| Token          | Light                 | Dark                  | Role                                                                                                                                                                             |
| -------------- | --------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--accent`     | `#007aff`             | `#0a84ff`             | Links, badge fill, pencil hover, active markers, primary fills on light                                                                                                          |
| `--accent-ink` | `#fff`                | `#fff`                | Glyph on accent fills (badge count)                                                                                                                                              |
| `--ink`        | `#1c1c1e`             | `#f2f2f7`             | Body text                                                                                                                                                                        |
| `--muted`      | `#6e6e73`             | `#98989f`             | Quiet voice: notes, cancel, icon buttons at rest                                                                                                                                 |
| `--ok`         | `#1f7a4d`             | `#7cc3a3`             | Success / TTS-active states                                                                                                                                                      |
| `--ok-wash`    | `#e6f4ea`             | `#12351f`             | Success surface (settings result wash)                                                                                                                                           |
| `--alarm`      | `#ff3b30`             | `#ff6b62`             | Live signals: recording states (popover tools, mic button)                                                                                                                       |
| `--danger`     | `#94250a`             | `#e89a90`             | All deletes: Clear-all, per-draft delete, sidebar chat delete. Deeper cut than alarm — small text needs the contrast                                                             |
| `--error-bg`   | `#fdecea`             | `#3d1008`             | Error toast / banner surface                                                                                                                                                     |
| `--error-ink`  | `#94250a`             | `#ffb4a2`             | Error toast / banner text (light value happens to equal danger — roles differ, keep both)                                                                                        |
| `--error-line` | `#e0a392`             | `#7a2a1c`             | Error toast border                                                                                                                                                               |
| `--sel-tint`   | `rgba(0,122,255,.28)` | `rgba(10,132,255,.4)` | `::selection` wash: the accent as plain rgba, not `color-mix` (Chromium serializes `color-mix()` unresolved, which breaks pins). Was indigo — the most AI-looking color we owned |
| `--hl`         | `#eef4ff`             | `#12233d`             | Attachment pills, jump highlight wash                                                                                                                                            |
| `--hover-wash` | `#ececf1`             | `#2c2c2e`             | Row hovers                                                                                                                                                                       |
| `--focus`      | `#3a3a3c`             | `#aeaeb2`             | Focus rings, selected-row marker                                                                                                                                                 |
| `--thinking-2` | `#5ac8fa`             | `#64d2ff`             | Thinking dots middle step (sky; dot 1 rides `--accent`)                                                                                                                          |
| `--thinking-3` | `#34c759`             | `#30d158`             | Thinking dots last step (green)                                                                                                                                                  |

## Exceptions (raw hex allowed, documented here)

- **Always-dark surfaces.** `.voice-error` (the floating speech error)
  is intentionally a dark pill in _both_ themes, so it keeps raw dark
  hexes — a theme token would flip it light and ruin the effect.
- **Light-only wash.** Settings selected rows wash `#e5f0ff` on light
  and invert on dark; the wash side has no dark twin, so it stays raw
  until dark selections want one.
- **Fallback lines.** The first line of every `hex` + `var()` pair,
  and the token definitions in `app.css` themselves.
- **Decorative dots.** The TTS speaking dot (`#30a46c`) and the
  waypoint assistant dot (`#30d158`) predate the system; unifying the
  greens is a follow-up, not this pass.

## Pinning (how colors stay put)

- Unit (`src/routes/color-tokens.test.ts`): asserts on source — the
  banned-hardcode list stays out of component styles, and every token
  above is actually referenced somewhere.
- E2E, both themes where the value moves: `toHaveCSS` on the computed
  color (e.g. `review note reads on light/dark`). E2E boots light by
  default (Playwright emulates light `prefers-color-scheme`), so an
  unseeded pin asserts the light value.
- When a palette value changes, the pin changes in the same commit —
  a red test here means the expectation is the bug report, not the code.

## Log

- **2026-09-18 — Thinking dots go tricolor, pill removed.** The
  sending chip's blue backplate is gone (plain status text); the
  three dots run accent blue → `--thinking-2` sky → `--thinking-3`
  green, per theme, so the dark override blocks delete. Dot 1 names
  `var(--accent)` directly — no second blue.
- **2026-09-16 — Blockquotes read as body text.** Quoted passages
  (translations, citations) were muted like metadata; the bar alone
  now carries the quote signal, text rides `--ink` both themes. Bar
  deepened one step to `--line-hover` for structure (still neutral —
  no accent bar).
- **2026-09-16 — Destination mark flash + sidebar tips.** The sent
  jump now wraps the quote in a draft-yellow `mark.ccez-ann-flash`
  (same phases as the wash): plain DOM renders in every engine, where
  the `::highlight` wash demonstrably didn't for some sessions. New
  `wrapRangeInMark`/`unwrapMark` in annotations.ts (unit-tested,
  collapsed ranges refuse). Sidebar rows pop message counts plus the
  you/assistant split on hover/focus (in-memory only — drafts live
  per-chat in storage).
- **2026-09-16 — Sent wash re-locates per phase.** Each blink phase
  re-runs the quote locator and paints a fresh range: a chat re-render
  mid-scroll detaches the old range, and the registry keeps dead ranges
  — repainting the same range blinks nothing while every probe stays
  green. Pinned via a live-range poll in the flash test.
- **2026-09-16 — Overlay + settings pass.** Sent-refs card follows the
  theme (panel surface, quiet note, ink icons on light; dark untouched),
  quote underlines fade via `text-decoration-color` on both cards, sent
  rows point only on the quote, pressed sent rows blink `--hl` like
  draft rows (the `::highlight` wash is engine-fragile, so the row blink
  is the guaranteed signal), new `--ok-wash` for the settings result.
  Summon fade measured working on the idle-restore path (pinned in
  chrome.e2e.ts) — instant-pops elsewhere need the summon identified.
- **2026-09-16 — Token pass.** New tokens `--accent`, `--accent-ink`,
  `--error-bg/ink/line`; `--alarm` redefined from `#c0362c`/`#e89a90`
  to the recording reds `#ff3b30`/`#ff6b62`; `--sel-tint` moved off
  indigo onto `color-mix` accent. Migrated: send/save light fills,
  pencil hover, sidebar active marker, waypoint dot, badges,
  paste-fold marker, range accent, settings selected border, recording
  states, sidebar delete (now `--danger`), error toast + banner
  (dark override blocks deleted). Visible changes, all intended:
  pencil/sidebar/badge blues converge on `--accent`; sidebar delete
  deepens slightly on light; selection wash goes indigo→blue.
- **2026-09-16 — Delete hover rides `--danger`.** The per-draft
  delete hardcoded `#ff453a` while Clear-all used the themed danger
  voice; pointed it at `var(--danger)` and fixed the pins that had
  enshrined the mismatch.
- **2026-09-16 — Review note rides `--muted`.** The note's pale
  `#c7c7cc` (tuned for dark cards) washed out on the white light
  drafting card; it now uses the quiet voice (`#6e6e73`/`#98989f`).
