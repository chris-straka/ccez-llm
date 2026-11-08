/**
 * Auto-fold rule (settings: fold older messages): a message folds once
 * a newer message of the same role exists, per role switched on. Pure
 * so the page effect stays a thin applier: it hands in what it already
 * handled and gets back what to fold and what to give back.
 *
 * A message reopened by hand stays open only until the next send: each
 * new message of mine starts a round, and a round folds every older
 * message again (owner, 2026-11-08: sending left reopened ones open).
 * The exception is a message with a note still waiting on its answer,
 * so the answer doesn't land somewhere folded away.
 */
export interface AutoFoldMessage {
	id: string;
	role: string;
	/** Rests folded on its own (a news opener): never auto-handled. */
	selfFolded?: boolean;
}

export interface AutoFoldPlan {
	/** Fold these now (newly older, not already folded). */
	fold: string[];
	/** The rule let go of these (its role switched off): unfold. */
	release: string[];
	/** Ids handled this round (an unfold by hand stays unfolded till the next send). */
	seen: Set<string>;
	/** The newest message of mine: a different one next time starts a round. */
	round: string | null;
}

export function autoFoldPlan(
	messages: readonly AutoFoldMessage[],
	roles: { user: boolean; assistant: boolean },
	seen: ReadonlySet<string>,
	autoFolded: ReadonlySet<string>,
	folded: ReadonlySet<string>,
	/** The round last seen in this chat; undefined (not known yet) starts none. */
	prevRound?: string | null,
	keepOpen: ReadonlySet<string> = new Set()
): AutoFoldPlan {
	const lastOf = new Map<string, string>();
	for (const m of messages) if (!m.selfFolded) lastOf.set(m.role, m.id);
	const round = lastOf.get("user") ?? null;
	// A send since the last pass: this chat's older messages are handled
	// afresh (other chats' ids stay, seen is shared across chats).
	const nextSeen = new Set(seen);
	if (prevRound !== undefined && round !== prevRound)
		for (const m of messages) nextSeen.delete(m.id);
	const fold: string[] = [];
	const release: string[] = [];
	const on = (role: string): boolean =>
		role === "user"
			? roles.user
			: role === "assistant"
				? roles.assistant
				: false;
	for (const m of messages) {
		if (m.selfFolded) continue;
		if (!on(m.role)) {
			nextSeen.delete(m.id);
			if (autoFolded.has(m.id)) release.push(m.id);
			continue;
		}
		if (lastOf.get(m.role) === m.id || nextSeen.has(m.id)) continue;
		nextSeen.add(m.id);
		if (!folded.has(m.id) && !keepOpen.has(m.id)) fold.push(m.id);
	}
	return { fold, release, seen: nextSeen, round };
}
