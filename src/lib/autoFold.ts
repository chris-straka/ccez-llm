/**
 * Auto-fold rule (settings: fold older messages): a message folds once
 * a newer message of the same role exists, per role switched on. Pure
 * so the page effect stays a thin applier: it hands in what it already
 * handled and gets back what to fold and what to give back.
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
	/** Ids the rule has now seen (an unfold by hand stays unfolded). */
	seen: Set<string>;
}

export function autoFoldPlan(
	messages: readonly AutoFoldMessage[],
	roles: { user: boolean; assistant: boolean },
	seen: ReadonlySet<string>,
	autoFolded: ReadonlySet<string>,
	folded: ReadonlySet<string>
): AutoFoldPlan {
	const nextSeen = new Set(seen);
	const fold: string[] = [];
	const release: string[] = [];
	const on = (role: string): boolean =>
		role === "user"
			? roles.user
			: role === "assistant"
				? roles.assistant
				: false;
	const lastOf = new Map<string, string>();
	for (const m of messages) if (!m.selfFolded) lastOf.set(m.role, m.id);
	for (const m of messages) {
		if (m.selfFolded) continue;
		if (!on(m.role)) {
			nextSeen.delete(m.id);
			if (autoFolded.has(m.id)) release.push(m.id);
			continue;
		}
		if (lastOf.get(m.role) === m.id || nextSeen.has(m.id)) continue;
		nextSeen.add(m.id);
		if (!folded.has(m.id)) fold.push(m.id);
	}
	return { fold, release, seen: nextSeen };
}
