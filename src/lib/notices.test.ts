import { describe, it, expect, vi } from "vitest";
import {
  emptyNotices,
  showNotice,
  expireNotice,
  clearNotice,
  flashNotice,
  TOAST_TIMEOUT_MS,
  ERROR_TOAST_TIMEOUT_MS
} from "./notices";

describe("notice queue", () => {
  it("shows and immediately clears each slot", () => {
    const state = emptyNotices();
    showNotice(state, "toast", "hi");
    expect(state.toast.message).toBe("hi");
    clearNotice(state, "toast");
    expect(state.toast.message).toBeNull();
  });

  it("a stale timer never clears a newer notice", () => {
    const state = emptyNotices();
    const first = showNotice(state, "voice", "old");
    const second = showNotice(state, "voice", "new");
    expect(second).toBeGreaterThan(first);
    expireNotice(state, "voice", first);
    expect(state.voice.message).toBe("new");
    expireNotice(state, "voice", second);
    expect(state.voice.message).toBeNull();
  });

  it("slots are independent", () => {
    const state = emptyNotices();
    showNotice(state, "inline", "attach failed");
    showNotice(state, "toast", "copied");
    clearNotice(state, "toast");
    expect(state.inline.message).toBe("attach failed");
    expect(state.toast.message).toBeNull();
  });

  it("error toasts live apart from info toasts", () => {
    const state = emptyNotices();
    showNotice(state, "toast", "copied");
    showNotice(state, "errorToast", "export failed");
    expect(state.toast.message).toBe("copied");
    expect(state.errorToast.message).toBe("export failed");
    clearNotice(state, "errorToast");
    expect(state.errorToast.message).toBeNull();
    expect(state.toast.message).toBe("copied");
  });

  it("flashNotice self-clears after the timeout", () => {
    vi.useFakeTimers();
    try {
      const state = emptyNotices();
      flashNotice(state, "banner", "no key", 5000);
      expect(state.banner.message).toBe("no key");
      vi.advanceTimersByTime(5000);
      expect(state.banner.message).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("plain toasts clear fast while error toasts hold the long delay", () => {
    expect(TOAST_TIMEOUT_MS).toBe(3000);
    expect(ERROR_TOAST_TIMEOUT_MS).toBe(8000);
  });

  it("re-flashing disarms the older timer without clearTimeout", () => {
    vi.useFakeTimers();
    try {
      const state = emptyNotices();
      flashNotice(state, "toast", "first", TOAST_TIMEOUT_MS);
      vi.advanceTimersByTime(1000);
      flashNotice(state, "toast", "second", TOAST_TIMEOUT_MS);
      vi.advanceTimersByTime(TOAST_TIMEOUT_MS);
      expect(state.toast.message).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
