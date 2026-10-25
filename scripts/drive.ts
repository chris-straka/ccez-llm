/**
 * Drive a running debug build from the terminal, without the mouse,
 * the keyboard or window focus: the debug-only MCP bridge
 * (tauri-plugin-mcp-bridge, localhost:9223-9322) runs JavaScript in
 * the window and takes native WKWebView snapshots, so an agent can
 * check the real shell engine while the owner keeps using the
 * machine. Release builds have no bridge (a control port in the
 * everyday app would let any local program read chats and keys).
 *
 *   bun scripts/drive.ts shot [out.png]      snapshot the window
 *   bun scripts/drive.ts js "<expression>"   run JS, print the result
 *   bun scripts/drive.ts click "<selector>"  click an element
 *   bun scripts/drive.ts key "<key>" [code]  press a key in the page
 *   bun scripts/drive.ts windows             list the app's windows
 *   bun scripts/drive.ts tour [dir]          shoot a fixed set of screens
 *                                            (chat, chat list, every page
 *                                            of Settings, an open card)
 *
 * A debug app bundle that runs beside the installed app without
 * sharing its data: `bun scripts/drive-app.ts` builds and opens it.
 */
import { Buffer } from "node:buffer";
import { mkdirSync, writeFileSync } from "node:fs";
import process from "node:process";

interface Reply {
	id: string;
	success?: boolean;
	data?: unknown;
	result?: unknown;
	error?: unknown;
}

/** The first bridge port that answers, scanning the plugin's range. */
async function connect(): Promise<WebSocket> {
	for (let port = 9223; port < 9323; port++) {
		const ws = await new Promise<WebSocket | null>((resolve) => {
			const socket = new WebSocket(`ws://127.0.0.1:${port}`);
			const timer = setTimeout(() => {
				socket.close();
				resolve(null);
			}, 400);
			socket.onopen = () => {
				clearTimeout(timer);
				resolve(socket);
			};
			socket.onerror = () => {
				clearTimeout(timer);
				resolve(null);
			};
		});
		if (ws) return ws;
	}
	throw new Error(
		"No debug build is running (the bridge answers on 9223-9322). Start one with `bun scripts/drive-app.ts`."
	);
}

async function send(
	ws: WebSocket,
	command: string,
	args: Record<string, unknown> = {}
): Promise<Reply> {
	const id = crypto.randomUUID();
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`${command} timed out`)),
			20_000
		);
		ws.addEventListener("message", function onMessage(event) {
			let reply: Reply;
			try {
				reply = JSON.parse(String(event.data)) as Reply;
			} catch {
				return;
			}
			if (reply.id !== id) return;
			clearTimeout(timer);
			ws.removeEventListener("message", onMessage);
			resolve(reply);
		});
		ws.send(JSON.stringify({ id, command, args }));
	});
}

/** Run `body` in the page; it may await and return any JSON value. */
function script(body: string): string {
	return `(async () => { ${body} })()`;
}

async function run(ws: WebSocket, body: string): Promise<unknown> {
	const reply = await send(ws, "execute_js", { script: script(body) });
	return reply.data ?? reply.result;
}

async function shot(ws: WebSocket, out: string): Promise<void> {
	const reply = await send(ws, "capture_native_screenshot", {
		format: "png"
	});
	const url = String(reply.data ?? "");
	if (!reply.success || !url.startsWith("data:"))
		throw new Error(`screenshot failed: ${JSON.stringify(reply.error)}`);
	writeFileSync(out, Buffer.from(url.split(",")[1] ?? "", "base64"));
}

const pause = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

/** A key on the window, as the page's capture listener sees it. */
function keyScript(init: KeyboardEventInit): string {
	return `
		(document.activeElement instanceof HTMLElement) && document.activeElement.blur();
		window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...${JSON.stringify(init)} }));
		return 1;
	`;
}

/**
 * The fixed review set, shot in the shell's own engine: the chat, the
 * chat list, Settings page by page, and the first word card if the
 * chat has one. Each screen closes before the next opens.
 */
async function tour(ws: WebSocket, dir: string): Promise<string[]> {
	mkdirSync(dir, { recursive: true });
	const shots: string[] = [];
	const take = async (name: string): Promise<void> => {
		await pause(700);
		const out = `${dir}/${String(shots.length + 1).padStart(2, "0")}-${name}.png`;
		await shot(ws, out);
		shots.push(out);
	};
	const escape = async (): Promise<void> => {
		for (let i = 0; i < 2; i++) {
			await run(ws, keyScript({ key: "Escape", code: "Escape" }));
			await pause(250);
		}
	};
	await escape();
	await take("chat");
	const listOpen = async (): Promise<boolean> =>
		Boolean(
			await run(
				ws,
				`return !!document.querySelector("aside:not(.collapsed):has(.side-search)");`
			)
		);
	await run(ws, keyScript({ key: "H", code: "KeyH", shiftKey: true }));
	await take("chat-list");
	// Shift+H toggles the list; Escape alone leaves it open.
	for (let i = 0; i < 3 && (await listOpen()); i++) {
		await run(ws, keyScript({ key: "H", code: "KeyH", shiftKey: true }));
		await pause(400);
	}
	await run(ws, keyScript({ key: ",", code: "Comma", metaKey: true }));
	await pause(500);
	const pages = Number(
		await run(
			ws,
			`const b = document.querySelector(".settings-panel");
			return b ? Math.ceil(b.scrollHeight / (b.clientHeight * 0.9)) : 0;`
		)
	);
	for (let i = 0; i < pages; i++) {
		await run(
			ws,
			`const b = document.querySelector(".settings-panel");
			b.scrollTo({ top: ${i} * b.clientHeight * 0.9, behavior: "instant" });
			return 1;`
		);
		await take(`settings-${i + 1}`);
	}
	await escape();
	const card = await run(
		ws,
		`const badge = document.querySelector("[data-ann-badge]");
		if (!badge) return false;
		badge.closest(".rendered")?.scrollIntoView({ block: "start" });
		const r = badge.getBoundingClientRect();
		const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true };
		for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
			badge.dispatchEvent(new (type.startsWith("pointer") ? PointerEvent : MouseEvent)(type, at));
		return true;`
	);
	if (card) {
		await take("word-card");
		await escape();
	}
	return shots;
}

async function main(): Promise<void> {
	const [cmd, ...rest] = process.argv.slice(2);
	const ws = await connect();
	try {
		if (cmd === "shot") {
			const out = rest[0] ?? ".screenshots/drive.png";
			await shot(ws, out);
			console.log(out);
		} else if (cmd === "js") {
			const reply = await send(ws, "execute_js", {
				script: script(`return (${rest.join(" ")});`)
			});
			console.log(JSON.stringify(reply.data ?? reply.result ?? reply, null, 2));
		} else if (cmd === "click") {
			const sel = JSON.stringify(rest[0] ?? "");
			const reply = await send(ws, "execute_js", {
				script: script(`
					const el = document.querySelector(${sel});
					if (!el) return "no element matches " + ${sel};
					const r = el.getBoundingClientRect();
					const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true };
					for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
						el.dispatchEvent(new (type.startsWith("pointer") ? PointerEvent : MouseEvent)(type, at));
					return "clicked";
				`)
			});
			console.log(JSON.stringify(reply.data ?? reply));
		} else if (cmd === "key") {
			const key = JSON.stringify(rest[0] ?? "");
			const code = JSON.stringify(rest[1] ?? "");
			const reply = await send(ws, "execute_js", {
				script: script(`
					const target = document.activeElement ?? document.body;
					for (const type of ["keydown", "keyup"])
						target.dispatchEvent(new KeyboardEvent(type, { key: ${key}, code: ${code}, bubbles: true, cancelable: true }));
					return "pressed";
				`)
			});
			console.log(JSON.stringify(reply.data ?? reply));
		} else if (cmd === "tour") {
			const shots = await tour(ws, rest[0] ?? ".screenshots/tour");
			console.log(shots.join("\n"));
		} else if (cmd === "windows") {
			const reply = await send(ws, "list_windows");
			console.log(JSON.stringify(reply.data ?? reply, null, 2));
		} else {
			console.log(
				"usage: bun scripts/drive.ts shot [out.png] | js <expr> | click <selector> | key <key> [code] | tour [dir] | windows"
			);
		}
	} finally {
		ws.close();
	}
}

await main();
