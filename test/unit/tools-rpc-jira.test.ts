// Jira's part of the tools RPC: the plugin-specific block of src/host/tools-rpc.ts. The shared part is tested in
// tools-rpc.test.ts.
import { describe, expect, test } from "bun:test"
import { DENY_TOOLS, NOT_GRANTED_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/jira-tools.js"
import { ENDPOINT, PLUGIN_ID as JIRA_PLUGIN_ID, SERVER_NAME } from "../../src/constants.js"
import { KNOWN_READS, NEXT_STEPS, PLUGIN_ID, pluginError, shapeResult, TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { defaultRules } from "../../src/permissions.js"

describe("Jira's tools RPC", () => {
  test("is jira.issues.tools, under the plugin's own id", () => {
    expect(PLUGIN_ID).toBe(JIRA_PLUGIN_ID)
    expect(TOOLS_RPC_ID).toBe("jira.issues.tools")
  })

  test("its methods are exactly the known reads, the reads the default rules allow and the scope grants", () => {
    expect([...KNOWN_READS]).toEqual(READ_TOOLS.filter((tool) => !NOT_GRANTED_TOOLS.includes(tool)))
    expect(KNOWN_READS).toHaveLength(30)
    const allowed = defaultRules()
      .filter((rule) => rule.effect === "allow" && !NOT_GRANTED_TOOLS.some((tool) => rule.action === `${SERVER_NAME}_${tool}`))
      .map((rule) => rule.action)
    expect(KNOWN_READS.map((name) => `${SERVER_NAME}_${name}`)).toEqual(allowed)
    // The two account reads are methods too: a script must resolve the site before any other call.
    for (const name of ["atlassianUserInfo", "getAccessibleAtlassianResources"]) expect(KNOWN_READS).toContain(name)
  })

  test("no write, no denied tool, no scope-withheld read and no unknown tool is a method", () => {
    expect(KNOWN_READS.filter((name) => WRITE_TOOLS.includes(name) || DENY_TOOLS.includes(name) || NOT_GRANTED_TOOLS.includes(name))).toEqual([])
    for (const name of ["deleteJiraIssue", "manageJiraSprint", "getJiraWorkflows", "shiny_new_tool", "describe", "*"]) expect(KNOWN_READS).not.toContain(name)
    for (const name of DENY_TOOLS) expect(defaultRules()).toContainEqual({ action: `jira_${name}`, resource: "*", effect: "deny" })
  })

  test("names Jira's own commands in its next steps, the conflict's URL, the rate limit, and no per-account servers", () => {
    expect(NEXT_STEPS.AUTH_REQUIRED).toContain("/connect and choose Jira")
    expect(NEXT_STEPS.SERVER_CONFLICT).toContain("mcp.servers.jira")
    expect(NEXT_STEPS.SERVER_CONFLICT).toContain(ENDPOINT)
    expect(NEXT_STEPS.TOOL_UNAVAILABLE).toBe("Call describe to see which methods OpenCode lists now, and run /jira-status.")
    expect(NEXT_STEPS.UPSTREAM_ERROR).toContain("if Atlassian reports a rate limit, wait for the Retry-After seconds and make fewer calls at once")
    for (const step of Object.values(NEXT_STEPS)) expect(step).toMatch(/[^.]\.$/)
    expect(NEXT_STEPS.ACCOUNT_UNKNOWN).toBeUndefined()
  })

  test("passes every result through unchanged, and has no errors of its own", () => {
    const result = { output: { key: "PROJ-1" }, text: "{}" }
    for (const method of [...READ_TOOLS, ACCOUNT_METHOD, SITES_METHOD]) expect(shapeResult(method, result)).toBe(result)
    expect(pluginError(new Error("boom"))).toBeUndefined()
  })
})

/** The two account reads, by their upstream name: their results feed the Account and Sites rows, and are unchanged. */
const ACCOUNT_METHOD = "atlassianUserInfo"
const SITES_METHOD = "getAccessibleAtlassianResources"
