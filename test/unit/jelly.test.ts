import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { DISPLAY_NAME, SERVER_NAME } from "../../src/constants.js"
import { DESTRUCTIVE_TOOLS, EXPORT_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/jira-tools.js"
import { parseOptions } from "../../src/options.js"
import { ACCESS, defaultRules, evaluate } from "../../src/permissions.js"
import { SKILL_NAMES } from "../../src/skills.js"
import { ACCESS_CHOICES, type PluginSetting, settingChoices, settingsProblems, settingValueIssue } from "../support/jelly-settings.js"

/**
 * The `jelly` section of package.json, which Jelly reads without loading the plugin. Jelly's agents have no base allow
 * rule, so this plugin's own rules never reach them: Jelly writes each declared "ask" or "deny" as that tool's default.
 */

type Tool = { name: string; permission: string; effect: "allow" | "ask" | "deny"; readOnly: boolean }
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  files: string[]
  jelly: {
    title: string
    summary: string
    icon: string
    tools: Tool[]
    skills: string[]
    rpc: unknown[]
    views: unknown[]
    signIns: unknown[]
    contributes: unknown
  }
}
const { jelly } = pkg
const byPermission = new Map(jelly.tools.map((tool) => [tool.permission, tool]))

/** The declared tools the pinned scope keeps out, from test/fixtures/tool-registry.json. */
const SCOPE_GATED: Record<string, { availability?: string }> = Object.fromEntries(
  Object.entries((JSON.parse(readFileSync(new URL("../fixtures/tool-registry.json", import.meta.url), "utf8")) as { tools: Record<string, { availability?: string }> }).tools).filter(([, entry]) => entry.availability === "scope"),
)

describe("the jelly declaration", () => {
  test("declares every known tool once, every one allowed, and marks the reads read-only", () => {
    for (const tool of READ_TOOLS) expect(byPermission.get(`jira_${tool}`)).toMatchObject({ effect: "allow", readOnly: true })
    for (const tool of [...EXPORT_TOOLS, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS]) expect(byPermission.get(`jira_${tool}`)).toMatchObject({ effect: "allow", readOnly: false })
    expect(jelly.tools).toHaveLength(READ_TOOLS.length + EXPORT_TOOLS.length + WRITE_TOOLS.length + DESTRUCTIVE_TOOLS.length)
    expect([...byPermission.keys()].sort()).toEqual([...READ_TOOLS, ...EXPORT_TOOLS, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS].map((tool) => `jira_${tool}`).sort())
  })

  test("each declared effect is what the plugin's own default rules decide for that tool", () => {
    const rules = [{ action: "*", resource: "*", effect: "allow" as const }, ...defaultRules()]
    for (const tool of jelly.tools) expect([tool.permission, evaluate(rules, tool.permission)]).toEqual([tool.permission, tool.effect])
  })

  test("each tool's name is its Code Mode path, and its permission the host's action", () => {
    for (const tool of jelly.tools) {
      expect(tool.name).toStartWith(`${SERVER_NAME}.`)
      expect(tool.name.replaceAll(".", "_")).toBe(tool.permission)
      // A tool the pinned scope keeps out carries a note that says so; no other tool has one.
      const gated = Boolean(SCOPE_GATED[tool.permission.slice(SERVER_NAME.length + 1)])
      expect(Object.keys(tool).sort()).toEqual(gated ? ["effect", "name", "note", "permission", "readOnly"] : ["effect", "name", "permission", "readOnly"])
      if (gated) expect((tool as { note?: string }).note).toStartWith("Not loaded under this plugin's sign-in")
    }
  })

  test("uses only the keys Jelly reads: its contracts strip any other", () => {
    expect(Object.keys(jelly).sort()).toEqual(["contributes", "icon", "rpc", "signIns", "skills", "summary", "title", "tools", "views"])
  })

  test("names every skill the package ships, the one sign-in, and no views, RPC, feeds or widgets", () => {
    expect(jelly.title).toBe(DISPLAY_NAME)
    expect([...jelly.skills].sort()).toEqual(readdirSync(new URL("../../skills", import.meta.url)).sort())
    expect(jelly.skills).toEqual([...SKILL_NAMES])
    expect(jelly.signIns).toEqual([{ id: SERVER_NAME, label: DISPLAY_NAME, server: SERVER_NAME }])
    expect(jelly.rpc).toEqual([])
    expect(jelly.views).toEqual([])
    // The one setting is the access option, allowed by default, worded as in the family's other plugins.
    expect(jelly.contributes).toEqual({
      homeFeeds: [],
      homeWidgets: [],
      workKinds: [],
      settings: [{ key: "access", label: "Access", type: "string", default: "all", choices: [...ACCESS_CHOICES], description: "What Jira's tools may do without asking. Generates default rules for agents with a base allow rule." }],
    })
  })

  test("the summary is one line of 1 to 120 characters", () => {
    expect(jelly.summary.trim().length).toBeGreaterThan(0)
    expect(jelly.summary.length).toBeLessThanOrEqual(120)
    expect(jelly.summary).not.toContain("\n")
  })
})

describe("the jelly settings declare their choices", () => {
  const settings = (jelly.contributes as { settings: PluginSetting[] }).settings
  const access = settings.find((setting) => setting.key === "access")!
  const accepts = (options: Record<string, unknown>) => {
    try {
      parseOptions(options)
      return true
    } catch {
      return false
    }
  }

  test("Jelly's setting schema reads them", () => {
    expect(settingsProblems(settings)).toEqual([])
  })

  test("access offers Jelly's three choices, word for word, and the options parser takes exactly those", () => {
    expect(access.choices).toEqual([...ACCESS_CHOICES])
    expect(settingChoices(access)?.map((choice) => choice.value)).toEqual([...ACCESS])
    for (const { value } of ACCESS_CHOICES) expect(accepts({ access: value })).toBe(true)
    for (const value of ["read", "write", "none", "ALL"]) {
      expect(settingValueIssue(access, value)).not.toBeNull()
      expect(accepts({ access: value })).toBe(false)
    }
  })
})
