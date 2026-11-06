// The drift script against saved tool lists: the captured fixture (one name and description per tool), OpenCode's form
// with schemas, and edited copies. It reads files only.
import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { DENY_TOOLS, PARAMETERS, READ_TOOLS, WRITE_TOOLS } from "../../src/jira-tools.js"

const SCRIPT = fileURLToPath(new URL("../../scripts/check-jira-tools.mjs", import.meta.url))
const TOOLS = fileURLToPath(new URL("../../src/jira-tools.ts", import.meta.url))
const FIXTURE = fileURLToPath(new URL("./live-tools.json", import.meta.url))
const dir = mkdtempSync(join(tmpdir(), "jira-drift-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const ALL = [...READ_TOOLS, ...WRITE_TOOLS, ...DENY_TOOLS]
const recorded = () => (JSON.parse(readFileSync(FIXTURE, "utf8")) as { tools: { name: string }[] }).tools
/** One tool in OpenCode's form, with a schema. */
const opencode = (name: string, properties: Record<string, unknown> = { query: { type: "string" } }, required = ["query"], description = `Jira ${name}`) => ({
  id: `jira_${name}`,
  name,
  description,
  inputSchema: { type: "object", properties, required },
})

let files = 0
function drift(list: unknown, args: string[] = [], script = SCRIPT) {
  const file = join(dir, `tools-${++files}.json`)
  writeFileSync(file, JSON.stringify(list))
  const result = spawnSync("node", [script, file, ...args], { encoding: "utf8" })
  return { code: result.status, out: result.stdout, err: result.stderr }
}

/** A copy of the script next to a copy of the tool record whose PARAMETERS records `parameters`. */
function withParameters(parameters: Record<string, string[]>) {
  const root = mkdtempSync(join(dir, "recorded-"))
  mkdirSync(join(root, "scripts"))
  mkdirSync(join(root, "src"))
  copyFileSync(SCRIPT, join(root, "scripts", "check-jira-tools.mjs"))
  const source = readFileSync(TOOLS, "utf8").replace(/export const PARAMETERS: Readonly<Record<string, readonly string\[\]>> = \{\}/, `export const PARAMETERS: Readonly<Record<string, readonly string[]>> = ${JSON.stringify(parameters)}`)
  expect(source).toContain(JSON.stringify(parameters))
  writeFileSync(join(root, "src", "jira-tools.ts"), source)
  return join(root, "scripts", "check-jira-tools.mjs")
}

describe("npm run drift", () => {
  test("PARAMETERS records only known tools, each as name, required mark and type", () => {
    expect(Object.keys(PARAMETERS).filter((name) => !ALL.includes(name))).toEqual([])
    for (const entries of Object.values(PARAMETERS)) for (const entry of entries) expect(entry).toMatch(/^[a-z][a-z0-9_]*\*?:[a-z<>|]+$/)
  })

  test("the recorded list holds exactly the known tools, and shows no drift", () => {
    expect(recorded().map((tool) => tool.name).sort()).toEqual([...ALL].sort())
    const { code, out } = drift({ tools: recorded() }, ["--strict"])
    expect(out).toContain("Not checked: this list gives no input schemas")
    expect([code, out.trim().split("\n").at(-1)]).toEqual([0, "No drift."])
  })

  test("a list with schemas names every known tool whose parameters PARAMETERS does not record yet, as drift", () => {
    const tools = ALL.map((name) => opencode(name))
    const { code, out } = drift({ tools }, ["--strict"])
    const missing = ALL.filter((name) => !PARAMETERS[name])
    if (missing.length) {
      expect(code).toBe(1)
      expect(out).toContain("Parameters to record: the list gives this known tool's input, which PARAMETERS does not have yet:")
      for (const name of missing) expect(out).toContain(`  ${name}: query*:string`)
    } else expect(code).toBe(0)
  })

  test("once recorded, a parameter that is added, removed, made required or retyped is drift", () => {
    const script = withParameters(Object.fromEntries(ALL.map((name) => [name, ["query*:string", "limit:integer"]])))
    const same = ALL.map((name) => opencode(name, { query: { type: "string" }, limit: { type: "integer" } }))
    expect(drift({ tools: same }, ["--strict"], script)).toMatchObject({ code: 0, out: expect.stringContaining("No drift.") })
    const changed = same.map((tool) =>
      tool.name === "searchJiraIssuesUsingJql" ? opencode("searchJiraIssuesUsingJql", { query: { type: "string" }, limit: { type: "string" }, fields: { type: "array", items: { type: "string" } } }, ["query", "fields"]) : tool,
    )
    const { code, out } = drift({ tools: changed }, ["--strict"], script)
    expect(code).toBe(1)
    expect(out).toContain("  searchJiraIssuesUsingJql: +fields*:array<string> limit (integer -> string)")
  })

  test("reports added and possibly renamed tools, and treats removed tools as information", () => {
    const script = withParameters(Object.fromEntries(ALL.map((name) => [name, [`${name}_id*:string`, "limit:integer"]])))
    const tools = ALL.filter((name) => name !== "getJiraIssue" && name !== "listJiraBoards").map((name) => opencode(name, { [`${name}_id`]: { type: "string" }, limit: { type: "integer" } }, [`${name}_id`]))
    tools.push(opencode("getWorkItem", { getJiraIssue_id: { type: "string" }, limit: { type: "integer" } }, ["getJiraIssue_id"]))
    const { code, out } = drift({ tools }, ["--strict"], script)
    expect(code).toBe(1)
    expect(out).toContain("Added: listed by Atlassian, in no list of src/jira-tools.ts:\n  getWorkItem")
    expect(out).toContain("Removed: in src/jira-tools.ts, not in this list")
    expect(out).toContain("  listJiraBoards")
    expect(out).toContain("Possibly renamed: a removed tool and an added one take mostly the same parameters:\n  getJiraIssue -> getWorkItem")
  })

  test("a read whose description says it changes or sends something is flagged; nouns and other tools are not", () => {
    const quiet = [
      opencode("getJiraIssue", {}, [], "A work item by ID or key, with its fields and links."),
      opencode("listJiraIssueLinkTypes", {}, [], "The link types available; link two items with createJiraIssueLink."),
      opencode("searchJiraIssuesUsingJql", {}, [], "1. Create a work item with createJiraIssue after reading this."),
    ]
    const loud = [opencode("listJiraIssueWorklogs", {}, [], "Sends a reminder to everyone who owes hours."), opencode("getJiraBoardIssueData", {}, [], "This tool creates a saved view.")]
    const others = ALL.filter((name) => ![...quiet, ...loud].some((tool) => tool.name === name)).map((name) => opencode(name, {}, []))
    const { out } = drift({ tools: [...others, ...quiet, ...loud] })
    expect(out).toContain("  listJiraIssueWorklogs  (Sends)")
    expect(out).toContain("  getJiraBoardIssueData  (creates)")
    for (const tool of quiet) expect(out).not.toContain(`  ${tool.name}  (`)
  })

  test("a list from an MCP client with annotations shows a read that became a write", () => {
    const tools = recorded().map((tool) => ({ ...tool, annotations: { readOnlyHint: READ_TOOLS.includes(tool.name), destructiveHint: false } }))
    tools.find((tool) => tool.name === "getJiraIssue")!.annotations = { readOnlyHint: false, destructiveHint: false }
    const { code, out } = drift({ tools })
    expect(code).toBe(0)
    expect(out).toContain("Reclassified: the lists disagree with Atlassian's annotations:\n  getJiraIssue  readOnlyHint=false destructiveHint=false")
  })

  test("a removed tool alone is not drift: Jira may list fewer tools for less access", () => {
    const { code, out } = drift({ tools: recorded().filter((tool) => READ_TOOLS.includes(tool.name)) }, ["--strict"])
    expect(code).toBe(0)
    expect(out).toContain("No drift apart from the removed tools above.")
  })

  test("stops on Atlassian's meta-tool shape: the plugin registers the flat list, so the whole table would be wrong", () => {
    const { code, err } = drift({ tools: ["discover", "executeRead", "executeWrite", "executeDestructive", "atlassianUserInfo"].map((name) => ({ name })) }, ["--strict"])
    expect(code).toBe(2)
    expect(err).toContain("meta-tool shape")
    expect(err).toContain("https://mcp.atlassian.com/v2/mcp?tools=all")
  })

  test("refuses a file that is not a tool list, and a missing argument, with exit code 2", () => {
    expect(drift({ servers: [] }).code).toBe(2)
    const none = spawnSync("node", [SCRIPT], { encoding: "utf8" })
    expect(none.status).toBe(2)
    expect(none.stderr).toContain("no tool list given")
  })
})
