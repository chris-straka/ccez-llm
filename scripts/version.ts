// Pure version math for scripts/release.ts. Kept side-effect free so it
// stays unit-testable (see version.test.ts).
export type Bump = "major" | "minor" | "patch";

export interface Semver {
	major: number;
	minor: number;
	patch: number;
}

export function parseSemver(version: string): Semver {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	const major = match?.[1];
	const minor = match?.[2];
	const patch = match?.[3];
	if (major === undefined || minor === undefined || patch === undefined) {
		throw new Error(`Cannot bump non-semver version: ${version}`);
	}
	return { major: Number(major), minor: Number(minor), patch: Number(patch) };
}

export function bumpVersion(current: string, bump: Bump): string {
	const v = parseSemver(current);
	switch (bump) {
		case "major":
			return `${v.major + 1}.0.0`;
		case "minor":
			return `${v.major}.${v.minor + 1}.0`;
		case "patch":
			return `${v.major}.${v.minor}.${v.patch + 1}`;
	}
}

export function parseBump(args: string[]): Bump {
	const wantMajor = args.includes("--major");
	const wantMinor = args.includes("--minor");
	if (wantMajor && wantMinor)
		throw new Error("Pick one of --major or --minor.");
	return wantMajor ? "major" : wantMinor ? "minor" : "patch";
}
