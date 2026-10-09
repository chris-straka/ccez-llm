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
import type { ChatProvider } from "./providers/types";
import type { KeyValueStore } from "./settings";
import {
	cachedFeed,
	cachedNewsImage,
	cachedNewsUrl,
	createRateGate,
	decodeNewsLink,
	fetchRawPage,
	fetchWebviewImage,
	isNewsFallback,
	isWebviewUnsupported,
	JINA_QUOTA_COOLDOWN_MS,
	loadNewsPicks,
	loadNewsStories,
	newsConversationInstruction,
	newsErrorCopy,
	newsRegionsFor,
	newsSummaryInstruction,
	resolveArticleText,
	resolveImageBatch,
	resolveStoryImage,
	storeFeed,
	storeNewsImage,
	storeNewsLaunchImage,
	storeNewsPicks,
	storeNewsUrl,
	translateNewsTitles,
	withTranslatedTitles,
	type CefrLevel,
	type NewsKind,
	type NewsPanelState,
	type NewsStaged,
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
}

/** Mirrors the ThreadView news actions (kept structural there). */
export interface NewsModeActions {
	region: (gl: string) => void;
	/** Put a story in the chat (its session choices show under it). */
	pick: (link: string) => void;
	/** Take the staged story back out: headlines return. */
	unpick: () => void;
	kind: (kind: NewsKind) => void;
	level: (level: CefrLevel) => void;
	size: (size: SummarySize) => void;
	/** Start the staged story with its chosen kind, level, length. */
	launch: () => void;
	close: () => void;
	retry: () => void;
}

/** Raw (untranslated) headline loads stay shared this long. */
const RAW_FEED_TTL_MS = 5 * 60 * 1000;

/**
 * Learner news mode (empty chats only): story cards under the
 * pill rail. Picking a card stages the story in the chat with its
 * session choices; starting one seeds the composer and sends. The
 * page wires the deps.
 */
export class NewsMode {
	news = $state<NewsPanelState | null>(null);
	/** The story sitting in the chat, choices showing under it. */
	staged = $state<NewsStaged | null>(null);
	/** A launch is seeding the composer (blocks double starts). */
	newsBusy = $state<string | null>(null);
	/** Drops stale fetches (region/language hops). */
	newsSeq = 0;
	/** Bumped whenever the panel goes away: a story launch still
	fetching its article must not seed whatever chat comes next,
	even one showing the same language's panel. */
	private panelSeq = 0;
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
	/** Raw headline loads by `code|region`, shared between a hover
	 * prefetch and the open that follows it. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- fetch bookkeeping, never rendered.
	private rawFeeds = new Map<
		string,
		{ at: number; stories: Promise<NewsStory[]> }
	>();
	/** Article bodies in flight or done, by story link. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- fetch bookkeeping, never rendered.
	private articles = new Map<string, Promise<string>>();
	readonly actions: NewsModeActions;
	private readonly deps: NewsModeDeps;

	constructor(deps: NewsModeDeps) {
		this.deps = deps;
		this.actions = {
			region: (gl: string) => {
				void this.switchNewsRegion(gl);
			},
			pick: (link: string) => {
				this.pick(link);
			},
			unpick: () => {
				this.unpick();
			},
			kind: (kind: NewsKind) => {
				if (!this.staged || this.newsBusy) return;
				this.staged = { ...this.staged, kind };
				this.rememberPicks();
			},
			level: (level: CefrLevel) => {
				if (!this.staged || this.newsBusy) return;
				this.staged = { ...this.staged, level };
				this.rememberPicks();
			},
			size: (size: SummarySize) => {
				if (!this.staged || this.newsBusy) return;
				this.staged = { ...this.staged, size };
				this.rememberPicks();
			},
			launch: () => {
				const staged = this.staged;
				if (!staged) return;
				void this.launchNewsSession(
					staged.link,
					staged.kind,
					staged.level,
					staged.size
				);
			},
			close: () => {
				this.close();
			},
			retry: () => {
				if (!this.news || this.newsBusy) return;
				const staged = this.staged;
				if (staged?.article === "error") {
					this.articles.delete(staged.link);
					this.pick(staged.link);
					return;
				}
				this.rawFeeds.delete(`${this.news.code}|${this.news.region}`);
				this.news = { ...this.news, status: "loading", stories: [], error: "" };
				void this.fetchNewsStories();
			}
		};
	}

	private rememberPicks(): void {
		if (!this.staged) return;
		storeNewsPicks(this.deps.getStorage(), {
			kind: this.staged.kind,
			level: this.staged.level,
			size: this.staged.size
		});
	}

	/** Drop the panel without touching the composer (chat switches, sends). */
	clear(): void {
		this.panelSeq++;
		this.news = null;
		this.staged = null;
	}

	/** Close via ✕/language clear: panel away, composer back. */
	close(): void {
		this.panelSeq++;
		this.news = null;
		this.staged = null;
		this.deps.restorePrompt();
	}

	/** Stage a story in the chat and start reading its article. */
	pick(link: string): void {
		const current = this.news;
		if (!current || current.status !== "ready" || this.newsBusy) return;
		if (!current.stories.some((s) => s.link === link)) return;
		this.deps.tapTick();
		const picks = loadNewsPicks(this.deps.getStorage());
		this.staged = {
			link,
			kind: this.staged?.kind ?? picks.kind,
			level: this.staged?.level ?? picks.level,
			size: this.staged?.size ?? picks.size,
			article: "loading",
			error: ""
		};
		this.articleFor(link).then(
			() => {
				if (this.staged?.link === link)
					this.staged = { ...this.staged, article: "ready", error: "" };
			},
			(error: unknown) => {
				this.articles.delete(link);
				if (this.staged?.link === link)
					this.staged = {
						...this.staged,
						article: "error",
						error: newsErrorCopy(error)
					};
			}
		);
	}

	/** Back to the headlines (Esc, the staged card's ✕). */
	unpick(): void {
		if (!this.staged || this.newsBusy) return;
		this.staged = null;
	}

	/** One article fetch per link, shared by staging and launch. */
	private articleFor(link: string): Promise<string> {
		let pending = this.articles.get(link);
		if (!pending) {
			pending = resolveArticleText(
				link,
				decodeNewsLink,
				fetchRawPage,
				this.deps.getStorage()
			).then((r) => r.text);
			this.articles.set(link, pending);
		}
		return pending;
	}

	/** Open the story cards for a language (default region first). */
	enterNewsMode(code: string): void {
		const lang = replyLanguageFor(code);
		if (!lang) {
			this.news = null;
			return;
		}
		const regions = newsRegionsFor(code) ?? [];
		this.staged = null;
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

	/**
	 * Warm a language's default headlines and their pictures before
	 * it opens (hovering it in the language menu). Never translates:
	 * that spends the learner's key, so it waits for a real open.
	 */
	prefetch(code: string): void {
		const gl = newsRegionsFor(code)?.[0]?.gl;
		if (!gl || this.news?.code === code) return;
		const storage = this.deps.getStorage();
		if (cachedFeed(storage, code, gl)) return;
		const key = `${code}|${gl}`;
		if (this.rawFeeds.has(key)) return;
		this.rawStories(code, gl).then(
			(stories) => {
				void this.resolveNewsImages(code, gl, stories, () => true);
			},
			() => {}
		);
	}

	/** Headlines straight off the feeds, shared for a few minutes. */
	private rawStories(code: string, region: string): Promise<NewsStory[]> {
		const key = `${code}|${region}`;
		const hit = this.rawFeeds.get(key);
		if (hit && Date.now() - hit.at < RAW_FEED_TTL_MS) return hit.stories;
		const stories = loadNewsStories(code, region, fetchRawPage);
		this.rawFeeds.set(key, { at: Date.now(), stories });
		stories.catch(() => {
			if (this.rawFeeds.get(key)?.stories === stories)
				this.rawFeeds.delete(key);
		});
		return stories;
	}

	/** Headlines for the current panel language + region. */
	async switchNewsRegion(gl: string): Promise<void> {
		const current = this.news;
		if (!current || current.region === gl || this.newsBusy) return;
		const region = current.regions.find((r) => r.gl === gl);
		if (!region) return;
		// Translated headlines need the model: no key, no switch.
		if (
			region.translate &&
			!cachedFeed(this.deps.getStorage(), current.code, gl)
		) {
			const provider = await this.deps.resolveProvider();
			if (this.news !== current) return;
			if (!provider) {
				this.deps.toast(
					`Set an API key to translate ${region.label} headlines.`
				);
				this.deps.denyBuzz();
				return;
			}
		}
		this.deps.tapTick();
		this.staged = null;
		this.news = {
			...current,
			region: gl,
			status: "loading",
			stories: [],
			error: ""
		};
		void this.fetchNewsStories();
	}

	/**
	 * Preview images for stories the feed left imageless: decode,
	 * fetch the article HTML, and read its og:image — several at a
	 * time in card order, hits filed for later, misses silent.
	 * Blocked or bare pages fall through to the reader's first
	 * content image. Stale runs (region hops) file nothing visible;
	 * leftover transients settle to the letter tile, uncached, and
	 * retry next open.
	 */
	async resolveNewsImages(
		code: string,
		region: string,
		stories: NewsStory[],
		running: () => boolean = () =>
			this.news?.code === code && this.news?.region === region
	): Promise<void> {
		const storage = this.deps.getStorage();
		const visible = () =>
			this.news?.code === code && this.news?.region === region;
		const links = stories
			.filter(
				(s) =>
					!s.image &&
					!this.newsImageSession.has(s.link) &&
					!cachedNewsImage(storage, s.link)
			)
			.map((s) => s.link);
		await resolveImageBatch(links, {
			resolveOne: (link) =>
				resolveStoryImage(link, {
					decode: decodeNewsLink,
					fetchPage: fetchRawPage,
					gateJina: this.newsJinaGate,
					fresh: running,
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
								if (this.webviewUnsupported || this.webviewSkips.has(link))
									return null;
								try {
									return await fetchWebviewImage(articleUrl);
								} catch (error) {
									if (isWebviewUnsupported(error))
										this.webviewUnsupported = true;
									else this.webviewSkips.add(link);
									throw error;
								}
							}
				}),
			fresh: running,
			onSettled: (link, found, complete) => {
				// Complete results cache even when stale — only the
				// UI write is freshness-guarded, so hops never waste
				// fetches. Leftover transients file UI-only (no
				// session stamp), so next open retries them.
				if (complete) {
					this.newsImageSession.set(link, found);
					if (found) storeNewsImage(storage, link, found);
				}
				if (visible()) this.newsImages = { ...this.newsImages, [link]: found };
			}
		});
	}

	/** Already-known pictures for a story list (session, then disk). */
	private knownImages(stories: NewsStory[]): Record<string, string | null> {
		const storage = this.deps.getStorage();
		const prefill: Record<string, string | null> = {};
		for (const s of stories) {
			if (s.image) continue;
			const hit =
				this.newsImageSession.get(s.link) ?? cachedNewsImage(storage, s.link);
			if (hit) prefill[s.link] = hit;
			else if (this.newsImageSession.get(s.link) === null)
				prefill[s.link] = null;
		}
		return prefill;
	}

	async fetchNewsStories(): Promise<void> {
		const current = this.news;
		if (!current) return;
		const storage = this.deps.getStorage();
		const seq = ++this.newsSeq;
		const { code, region } = current;
		const stale = () =>
			this.newsSeq !== seq ||
			this.news?.code !== code ||
			this.news?.region !== region;
		const cached = cachedFeed(storage, code, region);
		if (cached) {
			this.newsImages = this.knownImages(cached);
			this.news = { ...current, status: "ready", stories: cached, error: "" };
			void this.resolveNewsImages(code, region, cached);
			return;
		}
		try {
			let stories = await this.rawStories(code, region);
			if (stale()) return;
			// Pictures resolve off links alone, so they start now and
			// show on the translating cards — not after.
			this.newsImages = this.knownImages(stories);
			void this.resolveNewsImages(code, region, stories);
			const target = newsRegionsFor(code)?.find((r) => r.gl === region);
			if (target?.translate) {
				this.news = { ...current, status: "translating", stories, error: "" };
				const provider = await this.deps.resolveProvider();
				if (!provider) throw new Error("news-translate");
				const titles = await translateNewsTitles(
					stories.map((s) => s.title),
					current.langName,
					async (prompt) =>
						(await provider.chat([{ role: "user", content: prompt }], {}))
							.content
				);
				stories = withTranslatedTitles(stories, titles);
			}
			if (stale()) return;
			storeFeed(storage, code, region, stories);
			this.news = { ...current, status: "ready", stories, error: "" };
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
	 * Story session launch: wait for the article, seed the composer
	 * with the short opener plus the article as a pasted attachment
	 * (bracketed as a paste region, spliced at send, folded back to a
	 * tag after), drop the news panel, and send — the chat holds only
	 * the session. Failures toast and stay staged to retry.
	 */
	async launchNewsSession(
		link: string,
		kind: NewsKind,
		level: CefrLevel,
		size: SummarySize
	): Promise<void> {
		const current = this.news;
		if (
			!current ||
			current.status !== "ready" ||
			this.newsBusy ||
			!this.deps.getEditor()
		)
			return;
		const story = current.stories.find((s) => s.link === link);
		if (!story) return;
		const instruction =
			kind === "talk"
				? newsConversationInstruction(story, level, current.langName, size)
				: newsSummaryInstruction(story, size, level, current.langName);
		// The story takes the composer: its opener replaces any dirty
		// draft (the seed lands after the fetch, so a failed launch
		// never eats typed text). Staged attachments still block —
		// those are explicit user files, never silently dropped, and
		// the launch sets its own pasted article over the slot.
		if (this.deps.getAttachments().length > 0) {
			this.deps.toastError(
				"Remove attachments first — the story brings its own article."
			);
			this.deps.denyBuzz();
			return;
		}
		let seeded = false;
		const panel = this.panelSeq;
		this.newsBusy = link;
		try {
			const text = await this.articleFor(link);
			// Closed, chat switched or deleted, or language-hopped
			// mid-flight: don't seed a dead panel.
			if (this.panelSeq !== panel || this.news?.code !== current.code) return;
			const image = story.image ?? this.newsImages[link];
			if (image)
				storeNewsLaunchImage(this.deps.getStorage(), story.title, image);
			const att = makePastedTextAttachment(
				`${PASTE_OPEN}${text}${PASTE_CLOSE}`
			);
			this.deps.setAttachments([att]);
			this.news = null;
			this.staged = null;
			this.deps.seedComposer(
				`${instruction} ${pastedTextMarker(att.text?.length ?? text.length)} `
			);
			seeded = true;
		} catch (error) {
			this.articles.delete(link);
			this.deps.toastError(newsErrorCopy(error));
			this.deps.denyBuzz();
		} finally {
			this.newsBusy = null;
		}
		if (seeded) this.deps.requestSend();
	}
}
