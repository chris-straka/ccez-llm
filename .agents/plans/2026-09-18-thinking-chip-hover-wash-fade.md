## Goal

Restyle the thinking indicator (no pill, more than blue) and give the badge hover wash a real fade in both directions — quick in, soft out — without reviving the DOM churn the Highlight path was built to kill.

## Success Criteria

- Thinking row has no backplate; the three dots read in three hues in both themes; label, pulse, and hover-only count unchanged.
- Hovering a badge ramps the wash in fast (~100ms); hovering off fades it over ~150ms instead of snapping (after the existing 120ms tremor delay).
- Badge-node-churn e2e stays green; `prefers-reduced-motion` snaps both directions instead of ramping.
- Full unit, check, lint, and the affected e2e files green; commit split per Work Plan.

## Context And Current Facts

- Chip today (`src/routes/+page.svelte`, `.sending-chip` styles): blue-tinted pill (`rgba(0,122,255,0.1)`, dark `0.18`), accent dots with pulse, localized label, hover-only count.
- Wash today: hover paints via `CSS.highlights` registry (`src/lib/annHighlights.ts`, `paintWashHighlight` in `src/lib/annotations.ts`); `::highlight(ccez-ann)` rules carry only `background-color` + `color`; hover-off clears after a 120ms shared hysteresis (`src/lib/hoverWash.ts`); DOM marks with fade keyframes remain the no-Highlights fallback.
- **Probe result (disposable `/tmp/hl-probe.mjs`, engines on disk): `transition` and `@keyframes` on `::highlight()` are ignored in both Chromium and Playwright WebKit — mid-ramp screenshots equal settled ones, while a positive control confirmed the wash does paint.** Fading the highlight rule itself is not an available move on this platform; the fade has to live outside the pseudo-element.

## Constraints And Non-goals

- No DOM-mark hover revival (churn/flicker), no new color system or framework, no gradient/glow styling.
- Rounded wash ends are a non-goal: square matches selection aesthetics, and rounding requires marks or overlays.
- The existing streaming e2e asserting a tinted chip *will* redden and must be updated in the same unit.

## Key Decisions

- **The option space is three primitives, not two.** Registry paint (instant, zero churn), DOM marks (fadeable and roundable, churn), overlay rects from `getClientRects` (fadeable and roundable, scroll/resize/reflow sync cost). Overlay rejected: rect-sync machinery plus z-order vs selection for a 150ms cosmetic is disproportionate; revisit only if rounded shape is ever demanded.
- **Fade both directions, asymmetric timing.** In fast (~100ms: faint → live) so the wash feels responsive rather than laggy; out soft (~150ms: live → dim → faint → clear). Same stepping machinery both ways, just different step counts.
- **Ramp as graded registry names, not timers on one name.** Three names (`ccez-ann`, `ccez-ann-dim`, `ccez-ann-faint`) with descending alphas, stepped ~50ms apart by the existing shared hysteresis machine — zero DOM churn preserved, cancellation falls out of the machine's existing disarm, teardown clears all three. Banding over these durations is imperceptible.
- **Chip color: tricolor dot sequence.** Dot 1 accent blue, dot 2 teal, dot 3 green, keeping the current staggered pulse; both themes. Rejected: per-language dot colors (invents an arbitrary mapping, new abstraction) and hue-drift animation (reads cheap, fights the calm row).

## Recommended Approach

Unit 1, chip: delete the pill (transparent chip, keep flex-gap layout), tricolor dots with dark-theme variants, keep label/elapsed/hover. Update `sending-chip.test.ts` and the streaming e2e tint assertion to the new contract.

Unit 2, wash: add the two dim registry names and a pure timeline helper covering both directions; hover-in steps faint → live (~100ms), the hysteresis null path steps live → dim → faint → clear (~150ms); re-hover disarms mid-ramp either way; `prefers-reduced-motion` snaps. Marks fallback, jump flashes, and streaming paths untouched.

## Work Plan

1. Chip restyle in `src/routes/+page.svelte` `<style>` only (no markup changes); extend `sending-chip.test.ts` (pill absent, three dot colors present); rewrite the streaming-integrity tint probe to assert dot colors.
2. `src/lib/annHighlights.ts`: graded names + bidirectional step helper (pure, unit-tested in `hoverWash.test.ts` style colocated test); `src/lib/hoverWash.ts`: ramp stepping on both the paint and null paths with disarm-cancel; both `::highlight` rule sets gain the dim/faint twins; reduced-motion gate.
3. Comment the why at each site (probe result, rejection of pseudo-fade and overlay).

## Validation Plan

- `bun run test src/routes/sending-chip.test.ts src/lib/hoverWash.test.ts` (or its new twin) while iterating; full `bun run test`, `check`, `lint` at the end.
- `E2E_PORT=5299 bunx playwright test e2e/streaming-integrity.e2e.ts` full file; annotations hover file full at the end (badge-churn guard).
- Manual/owner check in the Tauri shell: hover ramps in fast and fades out soft; reduced-motion snaps. (Screenshot pixel-pin of a mid-ramp frame is possible but brittle across GPUs — unit timeline plus visual check is the honest gate.)

## Risks / Rollback

- Alpha-step banding on dim displays: mitigated by short ramps; rollback is deleting two names and restoring instant paint plus single clear.
- Engine skew between Playwright WebKit and the system WKWebView: the ramp uses only registry set/delete, already the exercised path.
- Publish split: two commits in order (chip, wash) under the standing commit+push authorization once green.

## Open Questions

None — color direction, fade layer, and both-directions timing are decided above; approval covers them.

## Sources

- [MDN ::highlight()](https://developer.mozilla.org/en-US/docs/Web/CSS/::highlight) (allowable properties: color, background-color, text-decoration, text-shadow, stroke/fill — no opacity, no radius)
- [CSS Custom Highlight API Module Level 1](https://drafts.csswg.org/css-highlight-api-1/) (silent on transitions/animations; closed by the local probe instead)
