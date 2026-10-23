/**
 * Badges whose quotes end at (almost) the same spot, such as a word
 * at the end of an annotated sentence, would stamp on top of each
 * other. Each badge that lands on an earlier one steps aside by its
 * own width, in the reading direction, so every number shows.
 */

/** The badge's box as laid out with no step applied. */
export interface BadgeBox {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

function overlaps(a: BadgeBox, b: BadgeBox): boolean {
	return (
		a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
	);
}

/** How many badge widths each badge (in document order) steps aside. */
export function badgeSteps(boxes: readonly BadgeBox[], rtl = false): number[] {
	const placed: BadgeBox[] = [];
	return boxes.map((box) => {
		let step = 0;
		// Fields copied one by one: a DOMRect's are getters, which a
		// spread drops.
		const at = (n: number): BadgeBox => {
			const w = (box.right - box.left) * n * (rtl ? -1 : 1);
			return {
				left: box.left + w,
				right: box.right + w,
				top: box.top,
				bottom: box.bottom
			};
		};
		while (placed.some((p) => overlaps(p, at(step)))) step++;
		placed.push(at(step));
		return step;
	});
}

/** Apply the steps to a body's badges (`--ann-badge-step`). */
export function stackBadges(badges: readonly HTMLElement[]): void {
	for (const b of badges) b.style.removeProperty("--ann-badge-step");
	const boxes = badges.map((b) => b.getBoundingClientRect());
	const rtl = badges.some((b) => b.classList.contains("rtl"));
	badgeSteps(boxes, rtl).forEach((step, i) => {
		const b = badges[i];
		if (b && step > 0) b.style.setProperty("--ann-badge-step", String(step));
	});
}
