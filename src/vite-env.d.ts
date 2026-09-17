/// <reference types="vite/client" />

/**
 * Build-stamped settings footer (see SettingsPanel): Vite statically
 * replaces these at build time, defaulted in vite.config.js. Optional
 * because tests and unbuilt checkouts never see them.
 */
interface ImportMetaEnv {
	readonly VITE_BUILD_STAMP?: string;
	readonly VITE_APP_VERSION?: string;
}
