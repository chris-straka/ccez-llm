import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
// Explicit node: imports (never global `process`): with tsconfig
// `types: []`, @types/node stays out of the frontend, where no
// process object exists at runtime.
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
// @ts-expect-error — svelte-check only: sveltekit()'s Plugin<any>
// (from kit's own vite copy under Bun's pnpm layout) never compares
// clean against this tree's Vite 8 PluginOption, so overload
// resolution blows the stack. Runtime shape is correct and verified
// (dev/build/e2e run through this file). If a vite/kit upgrade turns
// this directive unused, delete it — that means the skew is gone.
export default defineConfig(() => ({
  plugins: [sveltekit()],
  resolve: {
    // Bun's pnpm-style layout leaves several physical copies of the
    // CodeMirror singletons (top-level real dirs plus .pnpm symlinks).
    // Without dedupe, esbuild/rollup can bundle two copies and
    // cross-copy `instanceof` checks fail.
    dedupe: ["@codemirror/state", "@codemirror/view"]
  },
  // Staleness marker (settings footer): installed builds show when
  // they were compiled, so "am I behind?" is one glance. Dev shows
  // "live" instead (HMR is always fresh; a server-start stamp would lie).
  define: {
    __BUILD_STAMP__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ") + "Z"),
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "0.0.0")
  },
  optimizeDeps: {
    // lindera-wasm resolves its .wasm sibling via `new URL(..., import.meta.url)`;
    // pre-bundling would relocate the glue and break that link (per its docs).
    exclude: ["lindera-wasm"]
  },
  test: {
    // Isolated agent worktrees live under .muse/ inside the checkout:
    // their checkouts lack node_modules, so their tests must never run
    // as part of this tree's suite.
    exclude: ["**/.muse/**", "**/node_modules/**"]
  },
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    // No hmr key at all without a mobile host: HmrOptions takes no
    // explicit undefined.
    ...(host ? { hmr: { protocol: "ws", host, port: 1421 } } : {}),
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
