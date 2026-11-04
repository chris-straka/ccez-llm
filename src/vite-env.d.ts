/// <reference types="vite/client" />

/**
 * Build-stamped settings footer (see SettingsPanel): Vite statically
 * replaces these at build time, defaulted in vite.config.js. Optional
 * because tests and unbuilt checkouts never see them.
 */
interface ImportMetaEnv {
	readonly VITE_BUILD_STAMP?: string;
	readonly VITE_APP_VERSION?: string;
	// Dev-only `.env` prefill (settings.ts devEnv); never in a build.
	readonly VITE_MUSE_API_KEY?: string;
	readonly VITE_MUSE_BASE_URL?: string;
	readonly VITE_DEEPSEEK_API_KEY?: string;
	readonly VITE_DEEPSEEK_BASE_URL?: string;
	readonly VITE_OPENCODE_ZEN_API_KEY?: string;
	readonly VITE_OPENCODE_ZEN_BASE_URL?: string;
}
