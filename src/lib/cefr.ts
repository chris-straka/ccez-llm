/** CEFR levels the learner tools speak in (news sessions, nudges). */
export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export const CEFR_LEVELS: Array<{ level: CefrLevel; tag: string }> = [
	{ level: "A1", tag: "Beginner" },
	{ level: "A2", tag: "Elementary" },
	{ level: "B1", tag: "Intermediate" },
	{ level: "B2", tag: "Upper intermediate" },
	{ level: "C1", tag: "Advanced" },
	{ level: "C2", tag: "Proficient" }
];

export function isCefrLevel(value: unknown): value is CefrLevel {
	return CEFR_LEVELS.some((l) => l.level === value);
}

/** One step easier (-1) or harder (+1), held at A1 and C2. Pure. */
export function stepLevel(level: CefrLevel, dir: -1 | 1): CefrLevel {
	const at = CEFR_LEVELS.findIndex((l) => l.level === level);
	return CEFR_LEVELS[Math.min(Math.max(at + dir, 0), CEFR_LEVELS.length - 1)]?.level ?? level;
}

export function cefrTag(level: CefrLevel): string {
	return CEFR_LEVELS.find((l) => l.level === level)?.tag ?? "";
}
