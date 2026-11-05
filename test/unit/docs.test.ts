// The docs and skills must match the code: tool names, the deny rules, error codes, the uninstall order and the Jelly
// guide. Every tool count they state is checked against src/jira-tools.ts, so a change there cannot leave a stale
// number behind.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { DENY_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/jira-tools.js"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
// Everything a user or the model reads about the current release.
const FILES = [
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "AGENTS.md",
  ...readdirSync(join(ROOT, "docs")).map((name) => `docs/${name}`),
  ...readdirSync(join(ROOT, "skills")).map((name) => `skills/${name}/SKILL.md`),
]
const KNOWN = [...READ_TOOLS, ...WRITE_TOOLS, ...DENY_TOOLS]
const text = (file: string) => readFileSync(join(ROOT, file), "utf8").replace(/\s+/g, " ")
const OPT_IN = '{ "action": "jira_deleteJiraIssue", "resource": "*", "effect": "ask" }'

describe("docs", () => {
  test.each(FILES)("%s states no count of read, write or declared tools that could go stale", (file) => {
    const counts = [...text(file).matchAll(/\b\d+ (?:known )?(?:read|write)(?:s\b| tools\b| read-only)|\b\d+ tools are declared/g)].map((match) => match[0])
    const stale = counts.filter((count) => !count.startsWith(`${READ_TOOLS.length} read`) && !count.startsWith(`${WRITE_TOOLS.length} write`) && count !== `${KNOWN.length} tools are declared`)
    expect(stale).toEqual([])
  })

  test.each(FILES)("%s names only Jira tools the plugin knows", (file) => {
    const named = [...text(file).matchAll(/\bjira_([a-zA-Z][A-Za-z0-9]*)(?![\w*])/g)].map((match) => match[1]!)
    expect(named.filter((tool) => !KNOWN.includes(tool))).toEqual([])
  })

  test.each(["README.md", "docs/configuration.md", "docs/scripting.md", "docs/jelly.md", "SECURITY.md"])("%s says nothing provisional or pending", (file) => {
    expect(text(file)).not.toMatch(/provisional|not yet (?:checked|published|signed)|private package|TODO/i)
  })

  test("the README names no version of the plugin, not even in an example", () => {
    expect(text("README.md")).not.toMatch(/opencode-jira@\d|\b0\.\d+\.\d+\b|\bv\d+\.\d+\.\d+\b/)
  })

  test("the README and the configuration guide give each denied tool its deny rule, and the guide the ask rule that turns it on", () => {
    const rule = (name: string, effect: string) => `{ "action": "jira_${name}", "resource": "*", "effect": "${effect}" }`
    for (const name of DENY_TOOLS) {
      for (const file of ["README.md", "docs/configuration.md"]) expect(text(file)).toContain(rule(name, "deny"))
      expect(text("docs/configuration.md")).toContain(rule(name, "ask"))
      // The opt-in is a per-call ask, never an allow.
      for (const file of FILES) expect(text(file)).not.toContain(rule(name, "allow"))
    }
    expect(text("skills/jira-write/SKILL.md")).toContain(OPT_IN)
  })

  test.each(FILES)("%s puts no ask or allow recipe for a Jira tool at the top level, where it would reach Explore", (file) => {
    const raw = readFileSync(join(ROOT, file), "utf8")
    // Every JSON example that is a config: its top-level permissions only tighten.
    for (const [, body] of raw.matchAll(/```json\n([^]*?)```/g)) {
      let config: unknown
      try {
        config = JSON.parse(body!)
      } catch {
        continue
      }
      const top = !Array.isArray(config) && typeof config === "object" && config !== null ? ((config as { permissions?: { action: string; effect: string }[] }).permissions ?? []) : []
      expect(top.filter((rule) => rule.action.startsWith("jira_") && rule.effect !== "deny")).toEqual([])
    }
    // Every ask or allow rule for one tool sits in an agent's own rules, said in its paragraph or code block. The
    // plugin's own block, which the plugin inserts itself, is the one exception.
    const blocks = raw.split(/\n\s*\n/)
    blocks.forEach((block, index) => {
      if (!/\{ "action": "jira_[A-Za-z]+", "resource": "\*", "effect": "(?:ask|allow)" \}/.test(block)) return
      const context = `${blocks[index - 1] ?? ""}\n${block}`
      if (/The plugin adds these\s+rules/.test(context)) return
      // "in your permissions or an agent's own" offers the top level too: it fails.
      const agentLevel = /agent's own|"agents"/.test(context) && !/\b(?:in|to) (?:your|the same) `permissions`|here or in an agent's own/.test(context.replace(/\s+/g, " "))
      expect({ file, block: block.slice(0, 120), agentLevel }).toEqual({ file, block: block.slice(0, 120), agentLevel: true })
    })
  })

  test("the strict-agent recipe repeats every deny after its jira_* ask, so no denied tool reopens", () => {
    const recipe = text("docs/configuration.md").split("A strict agent where every Jira tool asks")[1]?.split("```")[1] ?? ""
    const ask = recipe.indexOf('{ "action": "jira_*", "resource": "*", "effect": "ask" }')
    expect(ask).toBeGreaterThanOrEqual(0)
    for (const name of DENY_TOOLS) expect(recipe.indexOf(`{ "action": "jira_${name}", "resource": "*", "effect": "deny" }`)).toBeGreaterThan(ask)
  })

  test("the docs need no API token, and document the token entry without a credential", () => {
    expect(text("README.md")).toContain("No API token is needed or used.")
    expect(text("docs/configuration.md")).toContain("An API-token entry, for a headless machine")
    expect(text("docs/configuration.md")).toContain('"oauth": false')
    for (const file of FILES) {
      // No credential value of any kind, and no plaintext Basic value.
      expect(text(file)).not.toMatch(/Bearer [A-Za-z0-9_-]{8,}|"Authorization": "Basic [A-Za-z0-9+/=]{8,}/)
    }
  })

  // Once the plugin is removed and OpenCode reloads, `mcp logout jira` finds no server: sign out first.
  test("the README's Uninstall signs out before it removes the plugin", () => {
    const uninstall = /## Uninstall(.*?)## Links/.exec(text("README.md"))?.[1] ?? ""
    const logout = uninstall.indexOf("opencode mcp logout jira")
    const list = uninstall.indexOf("opencode auth list")
    const remove = uninstall.indexOf("opencode plugin remove @joe-broadhead/opencode-jira")
    expect(logout).toBeGreaterThanOrEqual(0)
    expect(list).toBeGreaterThan(logout)
    expect(remove).toBeGreaterThan(list)
  })

  // Every code the plugin's own code raises (the tools RPC's are in docs/scripting.md) has no service prefix and a row
  // in the configuration guide's Errors table.
  test("the configuration guide documents every error code the plugin raises, none with a service prefix", () => {
    const sources = readdirSync(join(ROOT, "src")).filter((name) => name.endsWith(".ts"))
    const codes = new Set(sources.flatMap((name) => [...readFileSync(join(ROOT, "src", name), "utf8").matchAll(/(?:jiraError|errorText)\(\s*"([A-Z][A-Z_]+)"/g)].map((match) => match[1]!)))
    expect(codes.size).toBeGreaterThan(3)
    const errors = /## Errors(.*?)## /.exec(text("docs/configuration.md"))?.[1] ?? ""
    const troubleshooting = /## Troubleshooting(.*?)## /.exec(text("README.md"))?.[1] ?? ""
    for (const code of codes) {
      expect(code).not.toStartWith("JIRA_")
      expect(errors).toContain(`| \`${code}\` |`)
      // Every code the plugin raises has a README troubleshooting row too.
      expect({ code, inReadme: troubleshooting.includes(`| \`${code}\` |`) }).toEqual({ code, inReadme: true })
    }
  })

  test("the configuration guide's Errors table lists only codes the plugin raises", () => {
    const sources = readdirSync(join(ROOT, "src")).filter((name) => name.endsWith(".ts") && name !== "tools-rpc.ts")
    const raised = sources.map((name) => readFileSync(join(ROOT, "src", name), "utf8")).join("\n")
    const errors = /## Errors(.*?)## /.exec(text("docs/configuration.md"))?.[1] ?? ""
    const documented = [...errors.matchAll(/\| `([A-Z][A-Z_]+)` \|/g)].map((match) => match[1]!)
    expect(documented.length).toBeGreaterThan(5)
    expect(documented.filter((code) => !raised.includes(`"${code}"`) && !raised.includes(`${code}:`))).toEqual([])
  })

  test("the Jelly guide describes the declaration as Jelly reads it, with no placeholder or version", () => {
    const guide = text("docs/jelly.md")
    expect(guide).not.toMatch(/`latest` is|None yet/)
    expect(guide).toContain("the one line in `jelly.summary`, and beside it the mark in `jelly.icon`")
    // Jelly's contracts drop an unknown top-level key; they do not refuse the declaration for it.
    expect(guide).toContain("drop a top-level key they don't know")
    expect(guide).not.toMatch(/refuses this declaration|accepts no unknown keys/)
    // A tool Atlassian adds later is undeclared, and Jelly runs it unasked: the guide says so plainly, a write included.
    expect(guide).toContain("A tool Atlassian adds later, a write included, is not declared, so in Jelly it is not asked about")
    expect(guide).toContain("it runs without asking, even if it changes something")
    const off = guide.split("- Off:")[1]?.split("- Everything else")[0] ?? ""
    for (const name of DENY_TOOLS) expect(off).toContain(`\`jira_${name}\``)
    const skills = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).jelly.skills as string[]
    expect(guide).toContain(`Declared: ${skills.map((name) => `\`${name}\``).join(", ")}.`)
  })

  test("the scripting guide points at the known reads, and gives Atlassian's rate limits, the cloudId and one call at a time", () => {
    const guide = text("docs/scripting.md")
    expect(guide).toContain("(`READ_TOOLS` in `src/jira-tools.ts`)")
    expect(guide).toContain("`Retry-After`")
    expect(guide).toContain("`X-RateLimit-Remaining`")
    expect(guide).toContain("Every call needs a `cloudId`")
    expect(guide).toContain("one at a time")
    expect(guide).toContain("Rovo credits")
  })

  test("the README's limits say the tool table comes from Atlassian's docs, and what Jelly cannot ask about", () => {
    const readme = text("README.md")
    expect(readme).toContain("The tool table comes from Atlassian's docs")
    expect(readme).toContain("has not been reconciled with a live tool list")
    expect(readme).toContain("In Jelly, a tool Atlassian adds is not asked about")
  })
})
