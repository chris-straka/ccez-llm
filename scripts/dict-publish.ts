/**
 * Upload built dictionary packs (dict-build.ts) to this repo's
 * `dictionaries` release, which the app downloads them from:
 *
 *   bun scripts/dict-publish.ts
 *
 * The release is a prerelease never marked latest: app updates read
 * /releases/latest, and a dictionary release there would hide the app
 * builds. Uploads replace same-named assets; the manifest goes last so
 * the app never sees a version whose pack isn't up yet.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const TAG = "dictionaries";
const OUT = ".dict-cache/out";

function gh(args: string[]): string {
	return execFileSync("gh", args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"]
	});
}

const manifest = JSON.parse(readFileSync(`${OUT}/manifest.json`, "utf8")) as {
	packs: Record<
		string,
		{
			file: string;
			sha256: string;
			sources: Array<{ name: string; license: string; url: string }>;
		}
	>;
};

// Every pack must be the file its manifest entry describes: a build
// that died partway (an unknown language) once left new packs beside
// old checksums, and the app refused those downloads.
const stale = Object.entries(manifest.packs).filter(
	([, p]) =>
		createHash("sha256")
			.update(readFileSync(`${OUT}/${p.file}`))
			.digest("hex") !== p.sha256
);
if (stale.length > 0) {
	console.error(
		`Not publishing: ${stale.map(([lang]) => lang).join(", ")} differ from ` +
			`manifest.json. Rebuild them (bun scripts/dict-build.ts <langs>).`
	);
	process.exit(1);
}

const credits = [
	...new Map(
		Object.values(manifest.packs)
			.flatMap((p) => p.sources)
			.map((s) => [s.name, s])
	).values()
]
	.map((s) => `- ${s.name}, ${s.license}: ${s.url}`)
	.join("\n");
const notes =
	"Dictionary packs for Ccez LLM's word cards. The app downloads a " +
	"language's pack the first time a word in it is annotated; these are " +
	"not app builds.\n\nSources:\n" +
	credits;

let exists = true;
try {
	gh(["release", "view", TAG, "--json", "tagName"]);
} catch {
	exists = false;
}
if (!exists)
	gh([
		"release",
		"create",
		TAG,
		"--title",
		"Dictionaries",
		"--target",
		"main",
		"--notes",
		notes,
		"--prerelease",
		"--latest=false"
	]);
else
	gh([
		"release",
		"edit",
		TAG,
		"--notes",
		notes,
		"--prerelease",
		"--latest=false"
	]);

const packs = Object.values(manifest.packs).map((p) => `${OUT}/${p.file}`);
gh(["release", "upload", TAG, ...packs, "--clobber"]);
gh(["release", "upload", TAG, `${OUT}/manifest.json`, "--clobber"]);
console.log(`published ${packs.length} packs to ${TAG}`);
