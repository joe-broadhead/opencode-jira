// Jira's part of the tools RPC: the plugin-specific block of src/host/tools-rpc.ts. The shared part is tested in
// tools-rpc.test.ts. The methods come from src/jira-tools.ts, the same table the reconcile fixture pins, so replacing
// test/unit/live-tools.json with a signed-in list updates both in one step.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { DESTRUCTIVE_TOOLS, EXPORT_TOOLS, NOT_GRANTED_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/jira-tools.js"
import { PLUGIN_ID as JIRA_PLUGIN_ID, SERVER_NAME } from "../../src/constants.js"
import { METHODS, NEXT_STEPS, PLUGIN_ID, pluginError, shapeInput, shapeResult, TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { defaultRules } from "../../src/permissions.js"

interface Recorded {
  readonly name: string
}
const RECORDED = (JSON.parse(readFileSync(new URL("./live-tools.json", import.meta.url), "utf8")) as { tools: Recorded[] }).tools.map((tool) => tool.name.replace(/^jira_/, ""))
const ACCOUNT_METHOD = "atlassianUserInfo"
const SITES_METHOD = "getAccessibleAtlassianResources"

const CLASS_OF = new Map<string, string>([
  ...READ_TOOLS.map((name) => [name, "read"] as const),
  ...EXPORT_TOOLS.map((name) => [name, "export"] as const),
  ...WRITE_TOOLS.map((name) => [name, "write"] as const),
  ...DESTRUCTIVE_TOOLS.map((name) => [name, "destructive"] as const),
])

describe("Jira's tools RPC", () => {
  test("is jira.issues.tools, under the plugin's own id", () => {
    expect(PLUGIN_ID).toBe(JIRA_PLUGIN_ID)
    expect(TOOLS_RPC_ID).toBe("jira.issues.tools")
  })

  test("its methods are every known tool by exact name, the same list the fixture reconciles to", () => {
    const names = METHODS.map((method) => method.name)
    expect(new Set(names).size).toBe(names.length)
    expect([...names].sort()).toEqual([...RECORDED].sort())
    expect([...names].sort()).toEqual([...READ_TOOLS, ...EXPORT_TOOLS, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS].sort())
    // The three reads the pinned scope does not grant stay methods: Atlassian simply does not list them.
    for (const name of NOT_GRANTED_TOOLS) expect(names).toContain(name)
    for (const name of ["shiny_new_tool", "describe", "*"]) expect(names).not.toContain(name)
    for (const method of METHODS) expect(method.kind).toBe("mcp")
  })

  test("gives each method its class, and read-only denies everything but a read", () => {
    const readOnly = defaultRules("read-only")
    for (const method of METHODS) {
      expect(CLASS_OF.get(method.name)).toBe(method.class)
      const action = `${SERVER_NAME}_${method.name}`
      // R18: every tool is allowed by default, so the class shows in the restricting values, not in the default one.
      if (method.class !== "read") expect(readOnly.filter((rule) => rule.action === action).map((rule) => rule.effect)).toEqual(["deny"])
      if (method.class === "read") expect(defaultRules().filter((rule) => rule.action === action).map((rule) => rule.effect)).toEqual(["allow"])
    }
  })

  test("names Jira's own commands in its next steps, the conflict's URL, the rate limit, the location, and no per-account servers", () => {
    expect(NEXT_STEPS.AUTH_REQUIRED).toContain("/connect and choose Jira")
    expect(NEXT_STEPS.SERVER_CONFLICT).toContain("mcp.servers.jira")
    // The URL itself is written once, in src/constants.ts: the step names it as the one /jira-status shows.
    expect(NEXT_STEPS.SERVER_CONFLICT).toContain('"?tools=all" URL it names')
    expect(NEXT_STEPS.TOOL_UNAVAILABLE).toBe("Call describe to see which methods OpenCode lists now, and run /jira-status.")
    expect(NEXT_STEPS.UPSTREAM_ERROR).toContain("if Atlassian reports a rate limit, wait for the Retry-After seconds and make fewer calls at once")
    expect(NEXT_STEPS.SESSION_UNKNOWN).toContain("x-opencode-directory")
    for (const step of Object.values(NEXT_STEPS)) expect(step).toMatch(/[^.]\.$/)
    expect(NEXT_STEPS.ACCOUNT_UNKNOWN).toBeUndefined()
  })

  test("passes every input through, passes every result through unchanged, and has no errors of its own", () => {
    const call = { sessionID: "ses_1", agent: "build", action: `${SERVER_NAME}_getJiraIssue` }
    const result = { output: { key: "PROJ-1" }, text: "{}" }
    expect(shapeInput("getJiraIssue", { issueKey: "PROJ-1" }, call)).toEqual({ issueKey: "PROJ-1" })
    for (const method of METHODS) expect(shapeResult(method.name, result, call)).toBe(result)
    for (const method of [ACCOUNT_METHOD, SITES_METHOD]) expect(shapeResult(method, result, call)).toBe(result)
    expect(pluginError(new Error("boom"))).toBeUndefined()
  })
})
