import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadSkills, parseSkill, registerSkills, SKILL_NAMES, SKILLS_DIR } from "../../src/skills.js"

const root = mkdtempSync(join(tmpdir(), "jira-skill-loading-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function skills(files: Record<string, string>) {
  const directory = mkdtempSync(join(root, "skills-"))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(directory, name))
    writeFileSync(join(directory, name, "SKILL.md"), text)
  }
  return directory
}

const ok = (name: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\nBody\n`

describe("skill loading", () => {
  test("the main skill and the one for changes", () => {
    expect([...SKILL_NAMES]).toEqual(["jira", "jira-write"])
    expect(SKILLS_DIR.replaceAll("\\", "/").endsWith("/skills/")).toBe(true)
  })

  test("parses LF and CRLF frontmatter into a skill", () => {
    for (const newline of ["\n", "\r\n"]) {
      const text = ["---", "name: jira", 'description: "Use Jira: find and read work items and boards."', "---", "", "# Jira", "Body."].join(newline)
      expect(parseSkill("jira", "/pkg/skills/jira/SKILL.md", text)).toEqual({
        id: "jira",
        name: "jira",
        description: "Use Jira: find and read work items and boards.",
        path: "/pkg/skills/jira/SKILL.md",
        content: "# Jira\nBody.",
      } as never)
    }
  })

  test.each([
    ["no frontmatter", "# Jira", "skills/jira/SKILL.md has no frontmatter"],
    ["the wrong name", "---\nname: other\ndescription: d\n---\n", 'skills/jira/SKILL.md must be named "jira" in its frontmatter'],
    ["no description", "---\nname: jira\n---\n", "skills/jira/SKILL.md has no description"],
  ])("rejects a skill with %s", (_, text, message) => {
    expect(() => parseSkill("jira", "/x", text)).toThrow(message)
  })

  test("loads every skill", async () => {
    const directory = skills(Object.fromEntries(SKILL_NAMES.map((name) => [name, ok(name)])))
    const loaded = await loadSkills(directory)
    expect(loaded.skills.map((skill): string => skill.id)).toEqual([...SKILL_NAMES])
    expect(loaded.problems).toEqual([])
  })

  test("a missing or broken skill becomes a problem for status, not a setup failure", async () => {
    const broken = skills({ jira: "---\nname: jira\n---\n", "jira-write": ok("jira-write") })
    const loaded = await loadSkills(broken)
    expect(loaded.skills.map((skill): string => skill.id)).toEqual(["jira-write"])
    expect(loaded.problems).toEqual(['SKILLS_INVALID: The "jira" skill was not loaded: skills/jira/SKILL.md has no description. Next step: Reinstall the plugin.'])
    const missing = await loadSkills(skills({ jira: ok("jira") }))
    expect(missing.problems).toEqual(['SKILLS_INVALID: The "jira-write" skill was not loaded: skills/jira-write/SKILL.md is missing. Next step: Reinstall the plugin.'])
  })

  test("an unreadable skill file is reported as unreadable, not missing", async () => {
    const directory = skills({ "jira-write": ok("jira-write") })
    mkdirSync(join(directory, "jira", "SKILL.md"), { recursive: true })
    expect((await loadSkills(directory)).problems).toEqual([
      'SKILLS_INVALID: The "jira" skill was not loaded: skills/jira/SKILL.md cannot be read (EISDIR). Next step: Reinstall the plugin.',
    ])
  })

  test("registers every loaded skill", async () => {
    const added: string[] = []
    await registerSkills(
      { transform: async (callback) => (callback({ add: (skill: { id: string }) => void added.push(skill.id) } as never), { dispose: async () => {} }) },
      [parseSkill("jira", "/x", "---\nname: jira\ndescription: d\n---\n")],
    )
    expect(added).toEqual(["jira"])
  })
})
