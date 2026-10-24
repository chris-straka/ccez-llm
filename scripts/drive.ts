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
 *
 * A debug app bundle that runs beside the installed app without
 * sharing its data: `bun scripts/drive-app.ts` builds and opens it.
 */
import { Buffer } from "node:buffer";
import { writeFileSync } from "node:fs";
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

async function main(): Promise<void> {
	const [cmd, ...rest] = process.argv.slice(2);
	const ws = await connect();
	try {
		if (cmd === "shot") {
			const out = rest[0] ?? ".screenshots/drive.png";
			const reply = await send(ws, "capture_native_screenshot", {
				format: "png"
			});
			const url = String(reply.data ?? "");
			if (!reply.success || !url.startsWith("data:"))
				throw new Error(`screenshot failed: ${JSON.stringify(reply.error)}`);
			writeFileSync(out, Buffer.from(url.split(",")[1] ?? "", "base64"));
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
		} else if (cmd === "windows") {
			const reply = await send(ws, "list_windows");
			console.log(JSON.stringify(reply.data ?? reply, null, 2));
		} else {
			console.log(
				"usage: bun scripts/drive.ts shot [out.png] | js <expr> | click <selector> | key <key> [code] | windows"
			);
		}
	} finally {
		ws.close();
	}
}

await main();
