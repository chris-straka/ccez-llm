import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { replyLanguageFor } from "./languages";
import {
	PASTE_CLOSE,
	PASTE_OPEN,
	makePastedTextAttachment,
	pastedTextMarker,
	type Attachment
} from "./attachments";
import type { PromptEditor } from "./editor";
import type { AnnotationId } from "./annotations";
import type { ChatProvider } from "./providers/types";
import type { KeyValueStore } from "./settings";
import {
	cachedNewsImage,
	cachedNewsUrl,
	createRateGate,
	decodeNewsLink,
	fetchRawPage,
	fetchWebviewImage,
	isNewsFallback,
	isWebviewUnsupported,
	JINA_QUOTA_COOLDOWN_MS,
	loadNewsStories,
	newsConversationInstruction,
	newsErrorCopy,
	newsRegionsFor,
	newsSummaryInstruction,
	resolveArticleText,
	resolveImageBatch,
	resolveStoryImage,
	storeNewsImage,
	storeNewsUrl,
	translateNewsTitles,
	withTranslatedTitles,
	type CefrLevel,
	type NewsKind,
	type NewsPanelState,
	type NewsPicker,
	type NewsStory,
	type SummarySize
} from "./news";

/** Page-owned collaborators the news cluster calls back into. */
export interface NewsModeDeps {
	getEditor: () => PromptEditor | null;
	getAttachments: () => Attachment[];
	setAttachments: (next: Attachment[]) => void;
	/** Muted composer seed (marker sync bridged inside). */
	seedComposer: (text: string) => void;
	toast: (message: string) => void;
	toastError: (message: string) => void;
	/** Light tick for accepted news taps (the page's buzzTap). */
	tapTick: () => void;
	/** Denial buzz for refused news taps (the page's buzzNo). */
	denyBuzz: () => void;
	resolveProvider: () => Promise<ChatProvider | null>;
	/** Lazy: only async legs touch storage (SSR-safe construct). */
	getStorage: () => KeyValueStore;
	isPhone: () => boolean;
	parkPrompt: () => void;
	restorePrompt: () => void;
	requestSend: () => void;
	onBadge: (id: AnnotationId, x: number, y: number) => void;
	onBadgeHover: (id: string | null) => void;
}

/** Mirrors the ThreadView news actions (kept structural there). */
export interface NewsModeActions {
	region: (gl: string) => void;
	menu: (link: string) => void;
	level: (link: string, level: CefrLevel) => void;
	size: (link: string, size: SummarySize) => void;
	launch: (link: string, kind: NewsKind) => void;
	close: () => void;
	retry: () => void;
	badge: (id: AnnotationId, x: number, y: number) => void;
	badgeHover: (id: string | null) => void;
}

/**
 * Learner news mode (empty chats only): story cards under the
 * pill rail; launching seeds the composer and sends. Moved out
 * of +page.svelte verbatim (STAGE 1); the page wires the deps.
 */
export class NewsMode {
	news = $state<NewsPanelState | null>(null);
	newsPicker = $state<NewsPicker | null>(null);
	newsBusy = $state<string | null>(null);
	/** Drops stale fetches (region/language hops). */
	newsSeq = 0;
	/** Scraped preview images by story link (null = none found). */
	newsImages = $state<Record<string, string | null>>({});
	newsImageSession = new SvelteMap<string, string | null>();
	/** One reader quota shared by every image worker (20/min keyless). */
	newsJinaGate = createRateGate(3000);
	/** Quota-breaker deadline: a Jina 429 parks image reader legs
	 * until this timestamp (epoch ms) instead of burning quota. */
	jinaQuotaUntil = 0;
	/** Hidden-leg attempts to skip this session (one slow timeout
	 * per story is enough; direct/reader legs still retry). */
	webviewSkips = new SvelteSet<string>();
	/** The shell answered `unsupported`: no hidden leg exists. */
	webviewUnsupported = false;
	readonly actions: NewsModeActions;
	private readonly deps: NewsModeDeps;

	constructor(deps: NewsModeDeps) {
		this.deps = deps;
		this.actions = {
			region: (gl: string) => {
				void this.switchNewsRegion(gl);
			},
			menu: (link: string) => {
				if (this.newsBusy) return;
				this.deps.tapTick();
				this.newsPicker =
					this.newsPicker?.link === link ? null : { link };
			},
			level: (link: string, level: CefrLevel) => {
				if (this.newsBusy) return;
				if (this.newsPicker?.link === link) {
					this.newsPicker = { ...this.newsPicker, level };
				}
			},
			size: (link: string, size: SummarySize) => {
				if (this.newsBusy) return;
				if (this.newsPicker?.link === link) {
					this.newsPicker = { ...this.newsPicker, size };
				}
			},
			launch: (link: string, kind: NewsKind) => {
				const level =
					this.newsPicker?.link === link
						? (this.newsPicker.level ?? "B2")
						: "B2";
				const size =
					this.newsPicker?.link === link
						? (this.newsPicker.size ?? "medium")
						: "medium";
				void this.launchNewsSession(link, kind, level, size);
			},
			close: () => {
				this.close();
			},
			badge: (id: AnnotationId, x: number, y: number) => {
				this.deps.onBadge(id, x, y);
			},
			badgeHover: (id: string | null) => {
				this.deps.onBadgeHover(id);
			},
			retry: () => {
				if (!this.news || this.newsBusy) return;
				this.news = { ...this.news, status: "loading", stories: [], error: "" };
				void this.fetchNewsStories();
			}
		};
	}

	/** Drop the panel without touching the composer (chat switches, sends). */
	clear(): void {
		this.news = null;
		this.newsPicker = null;
	}

	/** Fold open option rows (Esc, outside press). */
	dismissPicker(): void {
		this.newsPicker = null;
	}

	/** Close via ✕/language clear: panel away, composer back. */
	close(): void {
		this.news = null;
		this.newsPicker = null;
		this.deps.restorePrompt();
	}

	/** Open the story cards for a language (default region first). */
	enterNewsMode(code: string): void {
		const lang = replyLanguageFor(code);
		if (!lang) {
			this.news = null;
			return;
		}
		const regions = newsRegionsFor(code) ?? [];
		this.newsPicker = null;
		if (regions.length === 0) {
			this.news = {
				code,
				langName: lang.name,
				regions: [],
				region: "",
				status: "unsupported",
				stories: [],
				error: "",
				fallback: false
			};
			return;
		}
		this.news = {
			code,
			langName: lang.name,
			regions,
			region: regions[0]?.gl ?? "",
			status: "loading",
			stories: [],
			error: "",
			fallback: isNewsFallback(code)
		};
		// Headlines own the screen on desktop: park the composer
		// on the idle path (summon keys restore it — sending from
		// it drops the panel in doSend). Phones keep it up: there
		// is no summon gesture there, so parking would strand the
		// composer with no way to type past the headlines.
		if (!this.deps.isPhone()) this.deps.parkPrompt();
		void this.fetchNewsStories();
	}

	/** Headlines for the current panel language + region. */
	async switchNewsRegion(gl: string): Promise<void> {
		const current = this.news;
		if (!current || current.region === gl || this.newsBusy) return;
		const region = current.regions.find((r) => r.gl === gl);
		if (!region) return;
		// Translated headlines need the model: no key, no switch.
		if (region.translate) {
			const provider = await this.deps.resolveProvider();
			if (this.news !== current) return;
			if (!provider) {
				this.deps.toast(`Set an API key to translate ${region.label} headlines.`);
				this.deps.denyBuzz();
				return;
			}
		}
		this.deps.tapTick();
		this.newsPicker = null;
		this.news = { ...current, region: gl, status: "loading", stories: [], error: "" };
		void this.fetchNewsStories();
	}

	/**
	 * Preview images for stories the feed left imageless: decode,
	 * fetch the article HTML, and read its og:image — four at a
	 * time, hits filed for later, misses silent. Blocked or bare
	 * pages fall through to the reader's first content image.
	 * Stale runs (region hops) file nothing visible; leftover
	 * transients settle to the letter tile, uncached, and retry
	 * next open.
	 */
	async resolveNewsImages(code: string, region: string, stories: NewsStory[]): Promise<void> {
		const storage = this.deps.getStorage();
		const fresh = () => this.news?.code === code && this.news?.region === region;
		const links = stories
			.filter(
				(s) => !s.image && !this.newsImageSession.has(s.link) && !cachedNewsImage(storage, s.link)
			)
			.map((s) => s.link);
		await resolveImageBatch(links, {
			resolveOne: (link) =>
				resolveStoryImage(link, {
					decode: decodeNewsLink,
					fetchPage: fetchRawPage,
					gateJina: this.newsJinaGate,
					fresh,
					cachedUrl: (l) => cachedNewsUrl(storage, l),
					storeUrl: (l, url) => storeNewsUrl(storage, l, url),
					jinaQuotaBlown: () => Date.now() < this.jinaQuotaUntil,
					flagJinaQuota: () => {
						this.jinaQuotaUntil = Date.now() + JINA_QUOTA_COOLDOWN_MS;
					},
					// Phones have no hidden leg; timed-out stories
					// skip it for the session (rethrow keeps the
					// transient verdict so cheap legs still retry).
					fetchWebview: this.deps.isPhone()
						? undefined
						: async (articleUrl) => {
								if (this.webviewUnsupported || this.webviewSkips.has(link)) return null;
								try {
									return await fetchWebviewImage(articleUrl);
								} catch (error) {
									if (isWebviewUnsupported(error)) this.webviewUnsupported = true;
									else this.webviewSkips.add(link);
									throw error;
								}
							}
				}),
			fresh,
			onSettled: (link, found, complete) => {
				// Complete results cache even when stale — only the
				// UI write is freshness-guarded, so hops never waste
				// fetches. Leftover transients file UI-only (no
				// session stamp), so next open retries them.
				if (complete) {
					this.newsImageSession.set(link, found);
					if (found) storeNewsImage(storage, link, found);
				}
				if (fresh()) this.newsImages = { ...this.newsImages, [link]: found };
			}
		});
	}

	async fetchNewsStories(): Promise<void> {
		const current = this.news;
		if (!current) return;
		const storage = this.deps.getStorage();
		const seq = ++this.newsSeq;
		const { code, region } = current;
		try {
			let stories = await loadNewsStories(code, region, fetchRawPage);
			// Images resolve off links alone, so start them while the
			// (slower) headline translation runs — not after. Dropped
			// dupes may resolve needlessly; the keyed writes ignore them.
			void this.resolveNewsImages(code, region, stories);
			const target = newsRegionsFor(code)?.find((r) => r.gl === region);
			if (target?.translate) {
				if (this.newsSeq !== seq || this.news?.code !== code || this.news?.region !== region) return;
				this.news = { ...current, status: "translating", stories: [], error: "" };
				const provider = await this.deps.resolveProvider();
				if (!provider) throw new Error("news-translate");
				const titles = await translateNewsTitles(
					stories.map((s) => s.title),
					current.langName,
					async (prompt) =>
						(
							await provider.chat([{ role: "user", content: prompt }], {})
						).content
				);
				stories = withTranslatedTitles(stories, titles);
			}
			if (this.newsSeq !== seq || this.news?.code !== code || this.news?.region !== region) return;
			this.news = { ...current, status: "ready", stories, error: "" };
			const prefill: Record<string, string | null> = {};
			for (const s of stories) {
				if (s.image) continue;
				const hit = this.newsImageSession.get(s.link) ?? cachedNewsImage(storage, s.link);
				if (hit) prefill[s.link] = hit;
				else if (this.newsImageSession.get(s.link) === null) prefill[s.link] = null;
			}
			// Images already resolving since load (see above) —
			// completed hits prefill here, the rest settle in.
			this.newsImages = prefill;
		} catch (error) {
			if (this.newsSeq !== seq || this.news?.code !== code) return;
			const message = error instanceof Error ? error.message : "";
			this.news = {
				...current,
				status: message.includes("news-needs-shell") ? "needs-shell" : "error",
				stories: [],
				error: newsErrorCopy(error)
			};
		}
	}

	/**
	 * Story session launch: resolve + fetch the article, seed the
	 * composer with the short opener plus the article as a pasted
	 * attachment (bracketed as a paste region, spliced at send,
	 * folded back to a tag after), drop the news panel, and send —
	 * the chat holds only the session. Failures toast and stay in
	 * news mode to retry.
	 */
	async launchNewsSession(
		link: string,
		kind: NewsKind,
		level: CefrLevel,
		size: SummarySize
	): Promise<void> {
		const current = this.news;
		if (!current || current.status !== "ready" || this.newsBusy || !this.deps.getEditor()) return;
		const story = current.stories.find((s) => s.link === link);
		if (!story) return;
		const instruction =
			kind === "talk"
				? newsConversationInstruction(story, level, current.langName)
				: newsSummaryInstruction(story, size, level, current.langName);
		// The story takes the composer: its opener replaces any dirty
		// draft (the seed lands after the fetch, so a failed launch
		// never eats typed text). Staged attachments still block —
		// those are explicit user files, never silently dropped, and
		// the launch sets its own pasted article over the slot.
		if (this.deps.getAttachments().length > 0) {
			this.deps.toastError("Remove attachments first — the story brings its own article.");
			this.deps.denyBuzz();
			return;
		}
		let seeded = false;
		this.newsBusy = link;
		try {
			const { text } = await resolveArticleText(
				link,
				decodeNewsLink,
				fetchRawPage,
				this.deps.getStorage()
			);
			// Closed or language-hopped mid-flight: don't seed a dead panel.
			if (this.news?.code !== current.code) return;
			const att = makePastedTextAttachment(`${PASTE_OPEN}${text}${PASTE_CLOSE}`);
			this.deps.setAttachments([att]);
			this.news = null;
			this.newsPicker = null;
			this.deps.seedComposer(
				`${instruction} ${pastedTextMarker(att.text?.length ?? text.length)} `
			);
			seeded = true;
		} catch (error) {
			this.deps.toastError(newsErrorCopy(error));
			this.deps.denyBuzz();
		} finally {
			this.newsBusy = null;
		}
		if (seeded) this.deps.requestSend();
	}
}
