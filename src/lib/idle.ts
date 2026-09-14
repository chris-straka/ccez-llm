/**
 * Prompt-idle hide/show decisions for +page.svelte.
 *
 * The stamp listeners, fade timer, press tracking, focus effects, and
 * every state mutation stay in the component: only the guard chains
 * move here, so each hide/summon rule is unit-tested without timers
 * or a DOM. Bodies keep their liveness checks and act on the tokens
 * with `if` chains.
 */

/** Shared hide preconditions: a chat must exist and overflow. */
function hideGuardsMet(emptyChat: boolean, fitsViewport: boolean): boolean {
	// An empty chat never hides, and neither does a thread that fits —
	// hiding only strands the composer.
	return !emptyChat && !fitsViewport;
}

/** Facts the always-hide focus-out path reads. */
export interface AlwaysHideFacts {
	alwaysMode: boolean;
	inPrompt: boolean;
	emptyChat: boolean;
	fitsViewport: boolean;
}

/**
 * Always-hide park: hide unless focus is (or is heading) inside the
 * composer, with the same empty and short-thread guards as the timed
 * path.
 */
export function shouldHideForAlways(facts: AlwaysHideFacts): boolean {
	return facts.alwaysMode && !facts.inPrompt && hideGuardsMet(facts.emptyChat, facts.fitsViewport);
}

/** Facts the hide ticker reads (the time beat stays extracted upstream). */
export interface IdleHideFacts {
	emptyChat: boolean;
	fitsViewport: boolean;
	alreadyIdle: boolean;
}

/** Timed hide: the guards above, plus never re-hide what is hidden. */
export function shouldIdleHide(facts: IdleHideFacts): boolean {
	return hideGuardsMet(facts.emptyChat, facts.fitsViewport) && !facts.alreadyIdle;
}

/**
 * Facts the hidden-prompt tap path reads, recorded at press time: a
 * press that traveled is a selection drag, a press that started on a
 * control or a live highlight is their dismissal, and a press that
 * started visible is the dismissing gesture itself — none of them
 * summon.
 */
export interface IdleTapFacts {
	downControl: boolean;
	downVisible: boolean;
	downHadSel: boolean;
	traveled: boolean;
	inMath: boolean;
	inClickControl: boolean;
	inOverlay: boolean;
}

export type IdleTapAction = "summon" | "summon-quiet";

/**
 * Phone tap-to-summon in press-guard order. `summon-quiet` restores
 * behind an overlay without landing focus (the overlay owns it);
 * `summon` lands in the composer once the visibility flip flushes.
 */
export function idleTapAction(facts: IdleTapFacts): IdleTapAction | null {
	if (facts.downControl) return null;
	if (facts.downVisible) return null;
	if (facts.downHadSel) return null;
	if (facts.traveled) return null;
	if (facts.inMath) return null;
	if (facts.inClickControl) return null;
	return facts.inOverlay ? "summon-quiet" : "summon";
}
