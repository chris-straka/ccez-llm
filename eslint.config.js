import js from "@eslint/js";
import tseslint from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default [
	// .muse/ and .claude/ hold retained agent worktrees (whole copies
	// of the repo): linting them spews phantom errors and ran the heap
	// out of memory, the same reason the vitest config excludes
	// **/.muse/**. Test output and screenshots are never source.
	{
		ignores: [
			"build/",
			".svelte-kit/",
			"dist/",
			"src-tauri/target/",
			"src-tauri/listen/target/",
			"src-tauri/gen/",
			".muse/",
			".claude/",
			".screenshots/",
			"test-results/",
			"playwright-report/"
		]
	},
	js.configs.recommended,
	// Type-checked rules (no-floating-promises, no-unsafe-*, ...) turn
	// agent conventions (void your promises, narrow your JSON) into red.
	...tseslint.configs.recommendedTypeChecked,
	...svelte.configs["flat/recommended"],
	prettier,
	...svelte.configs["flat/prettier"],
	{
		// Build tooling, e2e helpers, and vendored code live outside the
		// app tsconfig and lean on untyped Node/Vite APIs: base rules
		// only, no type-aware set.
		files: [
			"*.config.js",
			"*.config.ts",
			"playwright.config.ts",
			"e2e/**/*.ts",
			"vendor/**/*.ts",
			"scripts/**/*.ts"
		],
		...tseslint.configs.disableTypeChecked
	},
	{
		// Test doubles conform to async provider interfaces on purpose;
		// flagging their missing await is noise, not signal.
		files: ["**/*.test.ts", "e2e/**/*.ts"],
		rules: { "@typescript-eslint/require-await": "off" }
	},
	{
		// Per eslint-plugin-svelte docs: enable TypeScript parsing in .svelte files.
		languageOptions: {
			ecmaVersion: 2023,
			sourceType: "module",
			globals: { ...globals.browser },
			parserOptions: {
				parser: tseslint.parser,
				extraFileExtensions: [".svelte"],
				// Tooling outside the app tsconfig still needs a program to
				// parse under; disableTypeChecked below keeps base rules
				// only for those files.
				projectService: {
					// vite.config.js already belongs to a real project;
					// these leftovers get the default one instead.
					allowDefaultProject: [
						"svelte.config.js",
						"eslint.config.js",
						"playwright.config.ts",
						"package-overrides.test.ts",
						"vite-config.test.ts",
						"e2e/*.ts",
						"vendor/*.ts",
						"scripts/*.ts"
					],
					// Headroom over the ~90 e2e specs and the scripts: these
					// files run base rules only (disableTypeChecked above),
					// so the program is parse-only and the extra cost is small.
					maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 192
				},
				tsconfigRootDir: import.meta.dirname
			}
		}
	}
];
