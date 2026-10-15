/**
 * Undo the dead-key composition a consumed shortcut started.
 *
 * On layouts with dead keys on shortcut keys (Canadian Multilingual
 * Standard puts a dead circumflex on [), a Cmd/Ctrl chord pressed in a
 * text field can start a composition before or after its keydown runs:
 * WebKit applies the dead key first and reports keyCode 229, where
 * cancelling the keydown no longer stops it. The app handles the chord;
 * this puts the field back the way it was before that keystroke's
 * composition began, so no ^ is left behind.
 */

type TextField = HTMLTextAreaElement | HTMLInputElement;

interface Snapshot {
	field: TextField;
	value: string;
	start: number | null;
	end: number | null;
	at: number;
}

/** A composition that began this long before the chord's keydown
still belongs to that keystroke (WebKit composes first). */
const SAME_KEYSTROKE_MS = 60;

function textField(target: EventTarget | null): TextField | null {
	if (typeof HTMLTextAreaElement !== "undefined") {
		if (target instanceof HTMLTextAreaElement) return target;
		if (target instanceof HTMLInputElement) return target;
	}
	return null;
}

export interface ChordCompositionGuard {
	/** A chord consumed this keydown: undo any composition it began. */
	undo(target: EventTarget | null): void;
	dispose(): void;
}

export function createChordCompositionGuard(
	root: Pick<Document, "addEventListener" | "removeEventListener">,
	now: () => number = () => performance.now()
): ChordCompositionGuard {
	let last: Snapshot | null = null;
	const onStart = (event: Event): void => {
		const field = textField(event.target);
		if (!field) return;
		last = {
			field,
			value: field.value,
			start: field.selectionStart,
			end: field.selectionEnd,
			at: now()
		};
	};
	root.addEventListener("compositionstart", onStart, true);

	const restore = (field: TextField, since: number): boolean => {
		const snap = last;
		if (!snap || snap.field !== field || snap.at < since) return false;
		last = null;
		if (field.value !== snap.value) {
			// Setting the value also ends the open composition.
			field.value = snap.value;
			if (snap.start !== null && snap.end !== null)
				field.setSelectionRange(snap.start, snap.end);
			field.dispatchEvent(new Event("input", { bubbles: true }));
		}
		return true;
	};

	return {
		undo(target) {
			const field = textField(target);
			if (!field) return;
			const since = now() - SAME_KEYSTROKE_MS;
			// Composed already (WebKit order), or about to (Chromium).
			if (restore(field, since)) return;
			setTimeout(() => restore(field, since), 0);
		},
		dispose() {
			root.removeEventListener("compositionstart", onStart, true);
		}
	};
}
