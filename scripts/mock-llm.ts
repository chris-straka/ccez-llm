// Canned OpenAI-compatible endpoint for device and Simulator checks:
// GET /v1/models and POST /v1/chat/completions (SSE when `stream` is set)
// answer with a fixed reply, so a real chat can be screenshotted without
// an API key. Loopback only.
//   bun scripts/mock-llm.ts [port]   (default 8787)

const REPLY =
	"Bonjour ! « Je voudrais un café » is the polite way to order: " +
	"*voudrais* is the conditional of *vouloir*, softer than *je veux*. " +
	"Add « s'il vous plaît » and you are set.";

const port = Number(process.argv[2] ?? 8787);
const cors = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers": "*"
};

function chunk(delta: Record<string, string>, finish: string | null): string {
	const body = {
		id: "mock",
		object: "chat.completion.chunk",
		model: "mock-tutor",
		choices: [{ index: 0, delta, finish_reason: finish }]
	};
	return `data: ${JSON.stringify(body)}\n\n`;
}

Bun.serve({
	hostname: "127.0.0.1",
	port,
	async fetch(req) {
		const url = new URL(req.url);
		if (req.method === "OPTIONS")
			return new Response(null, { status: 204, headers: cors });
		if (url.pathname.endsWith("/models")) {
			return Response.json(
				{ object: "list", data: [{ id: "mock-tutor", object: "model" }] },
				{ headers: cors }
			);
		}
		if (!url.pathname.endsWith("/chat/completions"))
			return new Response("not found", { status: 404 });
		const body = (await req.json()) as { stream?: boolean };
		console.log("chat request");
		if (!body.stream) {
			return Response.json(
				{
					id: "mock",
					object: "chat.completion",
					model: "mock-tutor",
					choices: [
						{
							index: 0,
							message: { role: "assistant", content: REPLY },
							finish_reason: "stop"
						}
					],
					usage: { prompt_tokens: 12, completion_tokens: 40, total_tokens: 52 }
				},
				{ headers: cors }
			);
		}
		const words = REPLY.split(" ");
		const stream = new ReadableStream({
			async start(controller) {
				const enc = new TextEncoder();
				for (const word of words) {
					controller.enqueue(enc.encode(chunk({ content: `${word} ` }, null)));
					await Bun.sleep(40);
				}
				controller.enqueue(enc.encode(chunk({}, "stop")));
				controller.enqueue(enc.encode("data: [DONE]\n\n"));
				controller.close();
			}
		});
		return new Response(stream, {
			headers: { ...cors, "Content-Type": "text/event-stream" }
		});
	}
});
console.log(`mock LLM on http://127.0.0.1:${port}/v1`);
