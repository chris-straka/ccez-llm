/**
 * Settings stepper ladders and slider math: pure, so the controls in
 * `components/settings/` stay thin and the stepping rules are tested
 * here. A ladder is the ordered list of values a stepper visits; a
 * stored value that sits between rungs (an older slider position, a
 * hand-edited file) steps to the nearest rung in the pressed
 * direction, never past it.
 */
import {
	LINE_HEIGHT_MAX,
	LINE_HEIGHT_MIN,
	MESSAGE_GAP_MAX,
	MESSAGE_GAP_MIN,
	PROMPT_IDLE_ALWAYS,
	PROMPT_IDLE_MAX,
	PROMPT_IDLE_MIN,
	PROMPT_IDLE_NEVER,
	VOICE_SPEED_MAX,
	VOICE_SPEED_MIN
} from "./settings";

/** Evenly spaced rungs from `min` to `max` (inclusive), float-safe. */
export function linearLadder(min: number, max: number, step: number): number[] {
	const out: number[] = [];
	const count = Math.round((max - min) / step);
	for (let i = 0; i <= count; i++)
		out.push(Number((min + i * step).toFixed(6)));
	return out;
}

/** Text and prompt size, in percent: fine near 100%, coarse at the
giant end (the range reaches 2000% for very large type). */
export const TEXT_SIZE_LADDER: readonly number[] = [
	80, 90, 100, 110, 120, 135, 150, 175, 200, 225, 250, 300, 350, 400, 500, 600,
	700, 800, 1000, 1200, 1500, 2000
];
/** Interface zoom, in percent (100-250). */
export const UI_SIZE_LADDER: readonly number[] = [
	100, 110, 120, 130, 140, 150, 175, 200, 225, 250
];
/** Annotation popup size, in percent of message text (10-200). */
export const ANN_POP_LADDER: readonly number[] = [
	10, 25, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200
];
export const VOICE_SPEED_LADDER: readonly number[] = linearLadder(
	VOICE_SPEED_MIN,
	VOICE_SPEED_MAX,
	0.05
);
export const LINE_HEIGHT_LADDER: readonly number[] = linearLadder(
	LINE_HEIGHT_MIN,
	LINE_HEIGHT_MAX,
	0.1
);
/** Gap between messages, in rem; keeps the 0.35 default as a rung. */
export const MESSAGE_GAP_LADDER: readonly number[] = [
	MESSAGE_GAP_MIN,
	0.1,
	0.2,
	0.35,
	0.5,
	0.75,
	1,
	1.25,
	MESSAGE_GAP_MAX
];
/** Prompt idle-hide, in display order: always, 2-10 s, never. */
export const IDLE_LADDER: readonly number[] = [
	PROMPT_IDLE_ALWAYS,
	...linearLadder(PROMPT_IDLE_MIN, PROMPT_IDLE_MAX, 1),
	PROMPT_IDLE_NEVER
];

/** Idle values in ladder order (always < seconds < never), so an
off-ladder stored value still finds its neighbors. */
export function idleRank(sec: number): number {
	if (sec === PROMPT_IDLE_ALWAYS) return -Infinity;
	if (!(sec > 0)) return Infinity;
	return sec;
}

const EPS = 1e-6;

/**
 * Next rung from `current` in direction `dir` (+1 up, -1 down), or
 * `current` itself at either end. `rank` maps values onto an
 * increasing scale when the ladder isn't plain ascending numbers.
 */
export function stepLadder(
	ladder: readonly number[],
	current: number,
	dir: 1 | -1,
	rank: (value: number) => number = (v) => v
): number {
	const here = rank(current);
	if (dir > 0) {
		for (const value of ladder) if (rank(value) > here + EPS) return value;
	} else {
		for (let i = ladder.length - 1; i >= 0; i--) {
			const value = ladder[i]!;
			if (rank(value) < here - EPS) return value;
		}
	}
	return current;
}

/** Whether a step in `dir` would move (disables the end buttons). */
export function canStep(
	ladder: readonly number[],
	current: number,
	dir: 1 | -1,
	rank: (value: number) => number = (v) => v
): boolean {
	return stepLadder(ladder, current, dir, rank) !== current;
}

/** Trim trailing zeros: 1.50 → "1.5", 1.00 → "1". */
export function trimNumber(value: number, digits = 2): string {
	return String(Number(value.toFixed(digits)));
}

/** Slider value for a pointer at `x` over a track `[left, left+width]`,
snapped to `step` and clamped to the range. */
export function sliderValueAt(
	x: number,
	left: number,
	width: number,
	min: number,
	max: number,
	step: number
): number {
	if (!(width > 0)) return min;
	const t = Math.min(1, Math.max(0, (x - left) / width));
	const raw = min + t * (max - min);
	const snapped = min + Math.round((raw - min) / step) * step;
	return Number(Math.min(max, Math.max(min, snapped)).toFixed(6));
}

/** Fraction of the track a value sits at (thumb position). */
export function sliderFraction(
	value: number,
	min: number,
	max: number
): number {
	if (!(max > min)) return 0;
	return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/** Thumb grab radius in CSS px: presses farther than this from the
thumb's center never move a slider (no track-click jumps). */
export const THUMB_GRAB_PX = 22;

/** Whether a press at `x` lands on the thumb (within the grab radius). */
export function pressGrabsThumb(
	x: number,
	thumbCenterX: number,
	grabPx = THUMB_GRAB_PX
): boolean {
	return Math.abs(x - thumbCenterX) <= grabPx;
}
