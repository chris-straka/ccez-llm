import { describe, expect, it } from "vitest";
import type { Annotation, AnnotationId } from "./annotations";
import type { ChatId, ChatMsgId } from "./chat";
import {
	FlashcardsMode,
	type FlashcardsModeDeps
} from "./flashcards-mode.svelte";
import type { DeckKeyFacts, HarvestChat, ScheduleStore } from "./flashcards";

const chatA = "chat-a" as ChatId;

function draft(quote: string, answer: string): Annotation {
	return {
		id: `ann-${quote}` as AnnotationId,
		messageId: "m1" as ChatMsgId,
		quote,
		comment: "",
		answer,
		at: 0
	};
}

function memoryStore(): ScheduleStore & { data: Map<string, string> } {
	const data = new Map<string, string>();
	return {
		data,
		getItem: (k) => data.get(k) ?? null,
		setItem: (k, v) => void data.set(k, v)
	};
}

function keyFacts(over: Partial<DeckKeyFacts> = {}): DeckKeyFacts {
	return {
		key: "",
		code: "",
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		repeat: false,
		...over
	};
}

function harness(
	opts: {
		enabled?: boolean;
		empty?: boolean;
		shell?: boolean;
		phone?: boolean;
		save?: FlashcardsModeDeps["saveText"];
		copy?: FlashcardsModeDeps["copyText"];
	} = {}
) {
	const calls = {
		spoken: [] as { quote: string; id: string; context: string }[],
		stops: 0,
		focus: 0,
		toasts: [] as string[],
		errors: [] as string[],
		copied: [] as string[],
		downloads: [] as string[]
	};
	const chats: HarvestChat[] = [
		{
			id: chatA,
			messages: [
				{
					id: "m1" as ChatMsgId,
					role: "assistant",
					content: "Der Bahnhof ist groß. Das Haus ist alt."
				}
			]
		}
	];
	const drafts = [draft("Bahnhof", "station"), draft("Haus", "house")];
	let speaking: string | null = null;
	const store = memoryStore();
	const deck = new FlashcardsMode({
		getChats: () => chats,
		draftsFor: () => drafts,
		isEnabled: () => opts.enabled ?? true,
		isChatEmpty: () => opts.empty ?? true,
		isShell: () => opts.shell ?? true,
		isPhone: () => opts.phone ?? false,
		focusComposer: () => void calls.focus++,
		speakQuote: (quote, id, context) => {
			speaking = id;
			calls.spoken.push({ quote, id, context });
		},
		getSpeakingSelection: () => speaking,
		stopVoice: () => {
			speaking = null;
			calls.stops++;
		},
		saveText: opts.save ?? (async () => null),
		copyText:
			opts.copy ??
			(async (text) => {
				calls.copied.push(text);
			}),
		downloadText: (_text, filename) => void calls.downloads.push(filename),
		isDismissal: (error) =>
			error instanceof Error && error.message === "dismissed",
		toast: (m) => void calls.toasts.push(m),
		toastError: (m) => void calls.errors.push(m),
		store
	});
	return { deck, calls, store };
}

describe("FlashcardsMode", () => {
	it("counts due cards only when enabled on an empty chat", () => {
		expect(harness().deck.due).toBe(2);
		expect(harness({ enabled: false }).deck.due).toBe(0);
		expect(harness({ empty: false }).deck.due).toBe(0);
	});

	it("opens a sitting over the harvested cards", () => {
		const { deck } = harness();
		expect(deck.isOpen).toBe(false);
		deck.open();
		expect(deck.isOpen).toBe(true);
		expect(deck.session?.queue.map((c) => c.quote)).toEqual([
			"Bahnhof",
			"Haus"
		]);
		expect(deck.total).toBe(2);
	});

	it("flips before grading and persists the graded schedule", () => {
		const { deck, store } = harness();
		deck.open();
		deck.step("good");
		expect(deck.session?.flipped).toBe(true);
		expect(store.data.size).toBe(0);
		deck.step("good");
		expect(deck.session?.index).toBe(1);
		expect(deck.session?.reviewed).toBe(1);
		expect(store.data.size).toBe(1);
		expect(deck.due).toBe(1);
		expect(deck.nextDue).not.toBeNull();
	});

	it("dismissing a card drops it from the total", () => {
		const { deck } = harness();
		deck.open();
		deck.step("dismiss");
		expect(deck.total).toBe(1);
	});

	it("speaks the current card and reports it as speaking", () => {
		const { deck, calls } = harness();
		deck.open();
		expect(deck.speaking).toBe(false);
		deck.speak();
		expect(calls.spoken[0]).toMatchObject({
			quote: "Bahnhof",
			context: "Der Bahnhof ist groß."
		});
		expect(deck.speaking).toBe(true);
	});

	it("closing stops its own speech and refocuses the desktop composer", () => {
		const { deck, calls } = harness();
		deck.open();
		deck.speak();
		deck.close();
		expect(deck.isOpen).toBe(false);
		expect(calls.stops).toBe(1);
		expect(calls.focus).toBe(1);
	});

	it("closing on a phone leaves the keyboard down", () => {
		const { deck, calls } = harness({ phone: true });
		deck.open();
		deck.close();
		expect(calls.focus).toBe(0);
		expect(calls.stops).toBe(0);
	});

	describe("key", () => {
		const chord = keyFacts({ code: "KeyR", metaKey: true, shiftKey: true });

		it("the shell chord opens a closed deck", () => {
			const { deck } = harness();
			expect(deck.key(chord)).toBe(true);
			expect(deck.isOpen).toBe(true);
		});

		it("the chord passes outside the shell or when disabled", () => {
			expect(harness({ shell: false }).deck.key(chord)).toBe(false);
			expect(harness({ enabled: false }).deck.key(chord)).toBe(false);
		});

		it("an open deck acts on its keys and swallows other bare keys", () => {
			const { deck, calls } = harness();
			deck.open();
			expect(deck.key(keyFacts({ code: "Space", key: " " }))).toBe(true);
			expect(deck.session?.flipped).toBe(true);
			expect(deck.key(keyFacts({ code: "KeyS", key: "s" }))).toBe(true);
			expect(calls.spoken).toHaveLength(1);
			expect(deck.key(keyFacts({ code: "KeyJ", key: "j" }))).toBe(true);
			expect(
				deck.key(keyFacts({ code: "KeyC", key: "c", metaKey: true }))
			).toBe(false);
			expect(deck.key(keyFacts({ key: "Escape" }))).toBe(true);
			expect(deck.isOpen).toBe(false);
		});

		it("closed, ordinary keys pass", () => {
			expect(harness().deck.key(keyFacts({ code: "KeyJ", key: "j" }))).toBe(
				false
			);
		});
	});

	describe("exportAnki", () => {
		it("a native save toasts saved", async () => {
			const { deck, calls } = harness({ save: async () => "saved" });
			deck.open();
			await deck.exportAnki();
			expect(calls.toasts).toEqual(["Flashcards saved"]);
		});

		it("a dismissed dialog stays silent", async () => {
			const { deck, calls } = harness({ save: async () => "dismissed" });
			await deck.exportAnki();
			expect(calls.toasts).toEqual([]);
			expect(calls.downloads).toEqual([]);
		});

		it("the shell phone copies to the clipboard", async () => {
			const { deck, calls } = harness({ phone: true });
			deck.open();
			await deck.exportAnki();
			expect(calls.copied[0]).toContain("Bahnhof");
			expect(calls.toasts).toEqual(["Flashcards copied to clipboard"]);
		});

		it("a browser downloads the file", async () => {
			const { deck, calls } = harness({ shell: false });
			await deck.exportAnki();
			expect(calls.downloads).toHaveLength(1);
			expect(calls.toasts).toEqual(["Flashcards downloaded"]);
		});

		it("failures toast unless the user dismissed a permission", async () => {
			const failed = harness({
				save: async () => {
					throw new Error("disk");
				}
			});
			await failed.deck.exportAnki();
			expect(failed.calls.errors).toEqual(["Could not export flashcards"]);
			const dismissed = harness({
				save: async () => {
					throw new Error("dismissed");
				}
			});
			await dismissed.deck.exportAnki();
			expect(dismissed.calls.errors).toEqual([]);
		});
	});
});
