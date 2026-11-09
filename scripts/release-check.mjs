// Refuses a release whose version has no CHANGELOG.md section. The release workflow's guard checks the tag against the
// version; this checks that the release notes for it exist.
//   node scripts/release-check.mjs [root]
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** True when the changelog has a heading for the version, such as `## [1.2.3] - 2026-11-20` or `## 1.2.3`. */
export function hasReleaseSection(changelog, version) {
  return new RegExp(`^#{1,3}\\s+\\[?v?${escapeRegExp(version)}\\]?(?=\\s|$)`, "m").test(changelog)
}

function main(root) {
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8")
  if (hasReleaseSection(changelog, version)) {
    console.log(`release-check: OK, CHANGELOG.md has a section for ${version}`)
    return 0
  }
  console.error(`release-check: CHANGELOG.md has no section for ${version}. Add one before tagging.`)
  return 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv[2] ?? fileURLToPath(new URL("..", import.meta.url)))
}
