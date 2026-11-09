// The release-notes check: the package version needs its own CHANGELOG.md section before a tag is cut.
import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT = fileURLToPath(new URL("../../scripts/release-check.mjs", import.meta.url))
const root = mkdtempSync(join(tmpdir(), "ashby-release-check-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

/** Runs the check on a fresh folder holding a package at `version` and the given changelog. */
function check(version: string, changelog: string) {
  const dir = mkdtempSync(join(root, "case-"))
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "ashby-check", version }))
  writeFileSync(join(dir, "CHANGELOG.md"), changelog)
  return spawnSync(process.execPath, [SCRIPT, dir], { encoding: "utf8" })
}

describe("release-check", () => {
  test("passes when the changelog has a section for the version", () => {
    const result = check("1.2.3", "# Changelog\n\n## [1.2.3] - 2026-11-20\n\n### Added\n\n- A change.\n")
    expect({ status: result.status, out: result.stdout }).toEqual({ status: 0, out: "release-check: OK, CHANGELOG.md has a section for 1.2.3\n" })
  })

  test("refuses while the changes are still under Unreleased", () => {
    const result = check("0.0.0", "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- A change.\n")
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("CHANGELOG.md has no section for 0.0.0")
  })

  test("does not take a longer version for the one it names", () => {
    const result = check("1.2.3", "## [1.2.30] - 2026-11-20\n")
    expect(result.status).toBe(1)
  })
})
