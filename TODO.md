# Ccez LLM — TODO (only open work)

Finished stages live in `docs/DONE.md` (archive) — check items off by moving
them there, never by deleting. Spec is `README.md`; agent handoff
(commands, gates, architecture) is `AGENTS.md`.

## Goal + constraints

macOS desktop chatbot (BYOK: DeepSeek + Muse Spark): clean chat with
highlight-to-comment annotation, language-learner reading aids,
type-then-it-talks voice, vim-flavored prompt editing. Android rides the
same codebase via the Tauri mobile target.

- Free forever, offline-first, personal modern devices only, no paid accounts.
- Every OS supports every feature (macOS/Windows/Linux; Android where mobile).
- Commit + push when allowed.

## Standing decisions

- OS-native speech/OCR (no paid services). Per-arch DMGs, serialized
  single-writer release chain (verify -> publish -> prune -> rename).
- rAF scroll glide; per-chat draft scoping.
- FTS5 parked (IndexedDB not proven slow). Win/Linux device proof
  still needs real hardware; Android verifies on the S24 (release
  APKs + adb) — unit tests + honest unverified notes elsewhere,
  never pass claims.
- Ghost features: user believes all fixed — verify, then drop this item.

## Pile: Oct 2026 handoff (Muse)

Full specs, order, acceptance criteria, and gates live in
`docs/plans/2026-10-01-handoff.md` ("Who does what" has the order).

- [x] Fix two e2e failures that predate the plan ("Known failing")
- [ ] A8. Interface size slider (settings, chat list, dialogs, toasts)
- [ ] A7b. Voice speed on Windows/Linux; verify Android on the S24
- [ ] B. Annotation drafts controller out of `+page.svelte`
- [ ] C. Split `annotations.ts` by concern
- [ ] D. Deduplicate `annotations-stamp.ts` loops and ramps (after C)
- [ ] E. Prune refactor-history component tests and e2e trivia
- [ ] F. Focus-drop probe: ask the owner, then remove or keep
- [ ] G. Correction mode (French/German)
- [ ] H. Ace Attorney overlay window (macOS first)
- [ ] I. Hands-free conversation loop
- [ ] J. Desktop/phone shell split (after B, C)

## Found while working (open)

- Send-hold e2e fails on base: `composer-tools.e2e.ts` "desktop
  send-hold stashes and restores the reply language" — the 700ms
  hold never produces the "Effacé" toast (fails solo on a clean
  stash too, so it predates I). Not diagnosed; the hold path and
  `sendBtnEl` bind look intact statically.

## Non-goals

- No app-build/agentic features. No cloud sync / sharing / plugins.

## Verify (per AGENTS.md)

`bun run check` + `bun run test` + `cargo check/test` + focused e2e per area;
full suite before push. Device-only paths: unit tests + honest unverified
notes, never pass claims.
