import init, { TokenizerBuilder, loadDictionaryFromBytes } from "lindera-wasm";
import { unzipSync } from "fflate";
import { toHiragana } from "wanakana";
import { appRoot } from "./workerUrl";
import { furiganaLineHtml } from "./furiganaRuby";

/**
 * Furigana conversion off the main thread. Lindera's dictionary build
 * (10MB of trie construction, all synchronous) freezes the UI for a
 * while on first use — in a WebView that freeze reads as a crash.
 * Everything slow lives here; the main thread keeps the loading dots
 * animating and stays interactive throughout.
 *
 * Only conversion runs here: sanitizing needs DOMPurify's window, so the
 * worker returns raw ruby HTML and the caller sanitizes it.
 *
 * The dictionary ships inside the app (static/lindera, offline-first):
 * the single zip is unpacked in-memory, so no server encoding quirks
 * can corrupt the bytes the way transparent gzip once did kuromoji's.
 */

interface ConvertRequest {
	id: number;
	text: string;
	/** "tokens" asks for the analysis (word cards), not ruby HTML. */
	kind?: "tokens";
}

/** One analyzed piece of a word (IPAdic details). */
export interface JaToken {
	surface: string;
	/** Part of speech and its first subtype (動詞, 助動詞; 非自立). */
	pos: string;
	sub: string;
	/** Dictionary form (読む for 読ま). */
	base: string;
	/** Katakana reading. */
	reading: string;
}

async function analyze(text: string): Promise<JaToken[]> {
	const raw = (await ensureReady()).tokenize(text) as unknown;
	return (Array.isArray(raw) ? raw : []).map(
		(t: { surface?: unknown; details?: unknown }) => {
			const d = Array.isArray(t.details)
				? (t.details as unknown[]).map(String)
				: [];
			const surface = typeof t.surface === "string" ? t.surface : "";
			const field = (i: number): string => (d[i] && d[i] !== "*" ? d[i] : "");
			return {
				surface,
				pos: field(0),
				sub: field(1),
				base: field(6) || surface,
				reading: field(7)
			};
		}
	);
}

/** Minimal worker scope: lib.dom types the window flavor, not this one. */
interface WorkerScope {
	postMessage(message: unknown): void;
	addEventListener(type: "message", listener: (event: Event) => void): void;
}

const scope = self as unknown as WorkerScope;

/* App-rooted (never worker-relative): see workerUrl.ts. */
const DICT_URL = `${appRoot(self.location.href)}/lindera/lindera-ipadic-6.0.0.zip`;

/** Zip member names (under the lindera-ipadic/ prefix) in load order. */
const DICT_FILES = [
	"metadata.json",
	"dict.trie",
	"dict.valsidx",
	"dict.vals",
	"dict.wordsidx",
	"dict.words",
	"matrix.mtx",
	"char_def.bin",
	"unk.bin"
] as const;

type Tokenizer = ReturnType<TokenizerBuilder["build"]>;

let ready: Promise<Tokenizer> | null = null;

/**
 * Single shared init: overlapping conversions (the render effect can
 * refire mid-load on a new marks array) must all await the same
 * instance. A failed init resets so the next request retries instead of
 * replaying the same rejection.
 */
function ensureReady(): Promise<Tokenizer> {
	ready ??= (async () => {
		try {
			await init();
			const response = await fetch(DICT_URL);
			if (!response.ok) {
				throw new Error(`dictionary download failed (HTTP ${response.status})`);
			}
			const members = unzipSync(new Uint8Array(await response.arrayBuffer()));
			const at = (name: string): Uint8Array => {
				const bytes = members[`lindera-ipadic/${name}`];
				if (!bytes) throw new Error(`dictionary archive missing ${name}`);
				return bytes;
			};
			const dictionary = loadDictionaryFromBytes(
				at(DICT_FILES[0]),
				at(DICT_FILES[1]),
				at(DICT_FILES[2]),
				at(DICT_FILES[3]),
				at(DICT_FILES[4]),
				at(DICT_FILES[5]),
				at(DICT_FILES[6]),
				at(DICT_FILES[7]),
				at(DICT_FILES[8])
			);
			const builder = new TokenizerBuilder();
			builder.setDictionaryInstance(dictionary);
			builder.setMode("normal");
			return builder.build();
		} catch (error) {
			ready = null;
			throw error;
		}
	})();
	return ready;
}

async function convert(text: string): Promise<string> {
	return furiganaLineHtml(await ensureReady(), text, toHiragana);
}

scope.addEventListener("message", (event: Event) => {
	const request = (event as MessageEvent).data as ConvertRequest;
	if (request.kind === "tokens") {
		void analyze(request.text).then(
			(tokens) => scope.postMessage({ id: request.id, tokens }),
			(error: unknown) =>
				scope.postMessage({
					id: request.id,
					error: error instanceof Error ? error.message : String(error)
				})
		);
		return;
	}
	void convert(request.text).then(
		(html) => scope.postMessage({ id: request.id, html }),
		(error: unknown) =>
			scope.postMessage({
				id: request.id,
				error:
					error instanceof Error
						? `${error.message}\n${error.stack ?? ""}`
						: String(error)
			})
	);
});
