/**
 * One sleep-prevention claim held while anything wants the machine
 * awake. Requests resolve asynchronously, so the holder tracks one
 * request in flight: repeated "active" calls (speech moving to the
 * next message) never stack claims, and a claim that resolves after
 * the need passed is released at once.
 */
export function createSleepClaim(
	block: () => Promise<number | null>,
	unblock: (id: number) => void
): (active: boolean) => void {
	let held: number | null = null;
	let pending = false;
	let wanted = false;
	return (active) => {
		wanted = active;
		if (active) {
			if (held !== null || pending) return;
			pending = true;
			void block().then((id) => {
				pending = false;
				if (id === null) return;
				if (wanted && held === null) held = id;
				else unblock(id);
			});
		} else if (held !== null) {
			const id = held;
			held = null;
			unblock(id);
		}
	};
}
