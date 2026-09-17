import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// npm rejects an `overrides` pin that restates a direct dependency
// (EOVERRIDE: "conflicts with direct dependency"), and that breaks every
// `npx` invocation from the repo directory, including MCP servers.
// A `$` self-reference is npm's supported way to pin transitive copies
// onto the root's version, and bun honors it the same way.
const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as {
  dependencies?: Record<string, string>;
  overrides?: Record<string, string>;
};

describe('package.json overrides', () => {
  it('uses npm-compatible self-references for direct dependencies', () => {
    for (const [name, spec] of Object.entries(pkg.overrides ?? {})) {
      if (pkg.dependencies?.[name] !== undefined) {
        expect(spec).toBe(`$${name}`);
      }
    }
  });
});
