import { describe, expect, it } from "vitest";

import { type AgentDeps, type AgentLine, handleAgent } from "./agent";
import type { ChatProvider } from "./providers/types";

const provider: ChatProvider = {
	id: "apple",
	chat: () => Promise.resolve({ content: "J'ai faim." } as never),
	stream: (_m, cb) => {
		cb.onToken("J'ai ");
		cb.onToken("faim.");
		return Promise.resolve({ content: "J'ai faim." } as never);
	}
};

function deps(resolved: ChatProvider | null = provider): AgentDeps {
	return {
		resolve: () => resolved,
		annotate: (_p, q, _s, onPartial) => {
			onPartial({ answer: `dictionary: ${q.quote}` });
			return Promise.resolve({ answer: `model: ${q.quote} in "${q.context}"` });
		},
		status: () => ({ provider: "apple" })
	};
}

describe("agent API", () => {
	it("asks, streaming the reply", async () => {
		const lines: AgentLine[] = [];
		const result = await handleAgent("ask", { text: "hungry?" }, deps(), (l) =>
			lines.push(l)
		);
		expect(lines).toEqual([
			{ stage: "calling" },
			{ token: "J'ai " },
			{ token: "faim." },
			{ stage: "returned", length: 10 }
		]);
		expect(result).toEqual({ provider: "apple", answer: "J'ai faim." });
	});

	it("annotates: the first card, then the model's", async () => {
		const lines: AgentLine[] = [];
		const result = await handleAgent(
			"annotate",
			{ quote: "gare", context: "Je vais à la gare." },
			deps(),
			(l) => lines.push(l)
		);
		expect(lines).toEqual([{ partial: { answer: "dictionary: gare" } }]);
		expect(result).toMatchObject({
			answer: 'model: gare in "Je vais à la gare."'
		});
	});

	it("says what's wrong", async () => {
		await expect(
			handleAgent("ask", {}, deps(), () => undefined)
		).rejects.toThrow("needs text");
		await expect(
			handleAgent("ask", { text: "x" }, deps(null), () => undefined)
		).rejects.toThrow("No key");
		await expect(
			handleAgent("nope", {}, deps(), () => undefined)
		).rejects.toThrow('No command "nope"');
	});
});
