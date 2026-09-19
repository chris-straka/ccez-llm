// Release helper: bump the version everywhere it lives, commit the
// version files only, tag, and push. The `v*` tag is what starts release CI:
// one tag fans out to every platform job in .github/workflows/release.yml
// (macOS ad-hoc-signed per-arch .dmgs + updater artifacts, signed Android APK,
// plus the windows/linux/web sibling jobs). All targets read the same four
// version files below, so a single bump versions everything at once.
// No Apple Developer account, no notarization: the macOS bundle is ad-hoc
// signed (see docs/mac.md for the first-launch Gatekeeper steps).
// Usage: `bun run release [--major | --minor] [--dry-run]` (default: patch)
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { bumpVersion, parseBump } from "./version";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const bump = parseBump(args);

const run = (cmd: string): void => {
	console.log(`$ ${cmd}`);
	if (!DRY) execSync(cmd, { stdio: "inherit" });
};

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
	version: string;
};
const next = bumpVersion(pkg.version, bump);
const tag = `v${next}`;

// Refuse to run if the tag already exists or the version files are dirty:
// either means this release (or someone's edits) need attention first.
// (The "dirty" check: `git status` showing uncommitted changes in the four
// version files below. Committing over them would silently sweep someone
// else's in-progress edits into the release commit, so we stop instead.)
try {
	execSync(`git rev-parse --verify --quiet ${tag}`, { stdio: "pipe" });
	throw new Error(`Tag ${tag} already exists — nothing to do.`);
} catch (e) {
	if (e instanceof Error && e.message.startsWith("Tag ")) throw e;
}
const dirty = execSync("git status --porcelain", { encoding: "utf8" })
	.split("\n")
	.map((l) => l.slice(3))
	.filter((f) => f.length > 0);
const versionFiles = [
	"package.json",
	"src-tauri/tauri.conf.json",
	"src-tauri/Cargo.toml",
	"src-tauri/Cargo.lock"
];
const clashes = dirty.filter((f) => versionFiles.includes(f));
if (clashes.length > 0) {
	throw new Error(
		`Version files have uncommitted changes (${clashes.join(", ")}). Commit or stash them first.`
	);
}

console.log(`${pkg.version} -> ${next} (${bump})`);

const bumpTomlVersion = (
	path: string,
	version: string,
	anchor: string
): string => {
	const lines = readFileSync(path, "utf8").split("\n");
	const at = lines.findIndex((l) => l.trim() === anchor);
	if (at < 0) throw new Error(`${path}: anchor ${anchor} not found`);
	const vt = lines.findIndex((l, i) => i > at && /^version = "[^"]*"$/.test(l));
	if (vt < 0) throw new Error(`${path}: no version line after ${anchor}`);
	lines[vt] = `version = "${version}"`;
	return lines.join("\n");
};

if (!DRY) {
	pkg.version = next;
	writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");

	const confPath = "src-tauri/tauri.conf.json";
	const confText = readFileSync(confPath, "utf8");
	if (!/^(\s*)"version": "[^"]*"(,?)$/m.test(confText)) {
		throw new Error(`${confPath}: no top-level version line found`);
	}
	writeFileSync(
		confPath,
		confText.replace(
			/^(\s*)"version": "[^"]*"(,?)$/m,
			`$1"version": "${next}"$2`
		)
	);

	writeFileSync(
		"src-tauri/Cargo.toml",
		bumpTomlVersion("src-tauri/Cargo.toml", next, "[package]")
	);
	writeFileSync(
		"src-tauri/Cargo.lock",
		bumpTomlVersion("src-tauri/Cargo.lock", next, 'name = "ccez-llm"')
	);
	// The bump above writes 2-space JSON; re-format so releases stay
	// prettier-clean under the repo .prettierrc (tabs).
	execSync("bunx prettier --write package.json src-tauri/tauri.conf.json", {
		stdio: "inherit"
	});
}

run(`git add ${versionFiles.join(" ")}`);
run(`git commit -m "Release ${tag}"`);
run(`git tag -a ${tag} -m "Ccez LLM ${tag}"`);
run(`git push origin HEAD`);
run(`git push origin ${tag}`);
console.log(
	DRY
		? "(dry run — nothing changed)"
		: `Released ${tag}. CI is building all targets; publish the draft when green.`
);
