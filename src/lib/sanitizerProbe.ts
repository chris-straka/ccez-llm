/**
 * Native Sanitizer API investigation (DOMPurify replacement candidate
 * for render.ts).
 *
 * Verdict (Sep 2026): KEEP DOMPurify. The native Sanitizer API
 * (`window.Sanitizer`) ships only in Chromium, remains absent in Safari /
 * Firefox / the Tauri WebViews on several targets, and — critically — its
 * baseline config cannot express render.ts's allow-list: `ruby`/`rt`/`rp`
 * elements, `details`/`summary` disclosure chrome, `button` elements, and
 * `data-*` attributes (code/math indices, paste-fold markers, badge ids).
 * Adopting it would silently strip message chrome on every platform.
 * This probe exists so the adoption check is a one-liner when that
 * changes; sanitize() in render.ts stays DOMPurify-backed.
 */

export interface NativeSanitizerStatus {
	/** A global Sanitizer constructor exists at all. */
	available: boolean;
	/** Whether it can replace our DOMPurify config losslessly. */
	equivalent: boolean;
	/** Human-readable reason for the verdict. */
	reason: string;
}

/** Pure verdict over an observed Sanitizer constructor shape. */
export function judgeSanitizerShape(shape: {
	hasConstructor: boolean;
	supportsBaselineConfig: boolean;
	supportsCustomElementsAndDataAttrs: boolean;
}): NativeSanitizerStatus {
	if (!shape.hasConstructor) {
		return {
			available: false,
			equivalent: false,
			reason: "No global Sanitizer constructor; DOMPurify stays."
		};
	}
	if (
		!shape.supportsBaselineConfig ||
		!shape.supportsCustomElementsAndDataAttrs
	) {
		return {
			available: true,
			equivalent: false,
			reason:
				"Native Sanitizer present but cannot express the render.ts allow-list " +
				"(ruby/rt/rp, details/summary, button, data-*); DOMPurify stays."
		};
	}
	return {
		available: true,
		equivalent: true,
		reason: "Native Sanitizer present and equivalent; safe to adopt."
	};
}

/** Observe the live runtime and return the verdict. Never throws. */
export function nativeSanitizerStatus(): NativeSanitizerStatus {
	try {
		const ctor = (globalThis as Record<string, unknown>).Sanitizer;
		if (typeof ctor !== "function") {
			return judgeSanitizerShape({
				hasConstructor: false,
				supportsBaselineConfig: false,
				supportsCustomElementsAndDataAttrs: false
			});
		}
		// Even where the constructor exists, the baseline sanitizer
		// config drops our custom allow-list (no data-* / ruby / button
		// passthrough in the default baseline), so it is not equivalent
		// to the DOMPurify config in sanitize().
		return judgeSanitizerShape({
			hasConstructor: true,
			supportsBaselineConfig: true,
			supportsCustomElementsAndDataAttrs: false
		});
	} catch {
		return judgeSanitizerShape({
			hasConstructor: false,
			supportsBaselineConfig: false,
			supportsCustomElementsAndDataAttrs: false
		});
	}
}

/**
 * Guard for a future adoption: true only when the native Sanitizer is
 * present AND equivalent. Currently always false — render.ts keeps
 * DOMPurify. Callers branch on this, never on `available` alone.
 */
export function shouldUseNativeSanitizer(): boolean {
	return nativeSanitizerStatus().equivalent;
}
