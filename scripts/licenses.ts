/**
 * Write src/lib/licenses.generated.json, the list Settings → Licenses
 * shows: every library the app ships, JavaScript (the production
 * dependency tree under node_modules) and Rust (the shell's normal
 * dependencies from `cargo metadata`), each with its version and
 * license. Run after changing dependencies:
 *
 *   bun scripts/licenses.ts
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";

interface Library {
	name: string;
	version: string;
	license: string;
	url?: string;
}

interface PackageJson {
	name: string;
	version: string;
	license?: string | { type?: string };
	repository?: string | { url?: string };
	homepage?: string;
	dependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
}

/** A repository field as a browsable https link. */
function repoUrl(p: PackageJson): string | undefined {
	const raw =
		typeof p.repository === "string" ? p.repository : p.repository?.url;
	const url = (raw ?? p.homepage ?? "")
		.replace(/^git\+/, "")
		.replace(/^git:\/\//, "https://")
		.replace(/^github:/, "https://github.com/")
		.replace(/\.git$/, "");
	if (/^[\w.-]+\/[\w.-]+$/.test(url)) return `https://github.com/${url}`;
	return url.startsWith("https://") ? url : undefined;
}

/** Node's lookup: the nearest node_modules up from `from` holding `name`. */
function resolvePackage(name: string, from: string): string | null {
	let dir = from;
	for (;;) {
		const candidate = join(dir, "node_modules", name, "package.json");
		if (existsSync(candidate)) return candidate;
		const up = dirname(dir);
		if (up === dir) return null;
		dir = up;
	}
}

function jsLibraries(): Library[] {
	const root = JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;
	const out = new Map<string, Library>();
	const walk = (deps: Record<string, string>, from: string): void => {
		for (const name of Object.keys(deps)) {
			const path = resolvePackage(name, from);
			if (!path) continue;
			const p = JSON.parse(readFileSync(path, "utf8")) as PackageJson;
			const key = `${p.name}@${p.version}`;
			if (out.has(key)) continue;
			const license =
				typeof p.license === "string" ? p.license : (p.license?.type ?? "");
			const url = repoUrl(p);
			out.set(key, {
				name: p.name,
				version: p.version,
				license: license || "see package",
				...(url ? { url } : {})
			});
			walk(
				{ ...(p.dependencies ?? {}), ...(p.optionalDependencies ?? {}) },
				dirname(path)
			);
		}
	};
	walk(root.dependencies ?? {}, process.cwd());
	return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

interface CargoMetadata {
	packages: Array<{
		id: string;
		name: string;
		version: string;
		license: string | null;
		repository: string | null;
	}>;
	resolve: {
		root: string;
		nodes: Array<{
			id: string;
			deps: Array<{ pkg: string; dep_kinds: Array<{ kind: string | null }> }>;
		}>;
	};
}

function rustLibraries(): Library[] {
	const meta = JSON.parse(
		execFileSync("cargo", ["metadata", "--format-version", "1", "--locked"], {
			cwd: "src-tauri",
			encoding: "utf8",
			maxBuffer: 256 * 1024 * 1024
		})
	) as CargoMetadata;
	const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
	const packages = new Map(meta.packages.map((p) => [p.id, p]));
	// Normal dependencies only: build scripts and tests don't ship.
	const shipped = new Set<string>();
	const stack = [meta.resolve.root];
	while (stack.length > 0) {
		for (const dep of nodes.get(stack.pop()!)?.deps ?? []) {
			if (shipped.has(dep.pkg)) continue;
			if (!dep.dep_kinds.some((k) => k.kind === null)) continue;
			shipped.add(dep.pkg);
			stack.push(dep.pkg);
		}
	}
	return [...shipped]
		.map((id) => packages.get(id)!)
		.map((p) => ({
			name: p.name,
			version: p.version,
			license: p.license ?? "see crate",
			...(p.repository ? { url: p.repository } : {})
		}))
		.sort(
			(a, b) =>
				a.name.localeCompare(b.name) || a.version.localeCompare(b.version)
		);
}

const js = jsLibraries();
const rust = rustLibraries();
writeFileSync(
	"src/lib/licenses.generated.json",
	`${JSON.stringify({ js, rust }, null, "\t")}\n`
);
console.log(`${js.length} JavaScript and ${rust.length} Rust libraries`);
