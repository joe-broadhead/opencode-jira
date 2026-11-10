// The plugin on the public @opencode/sdk host: H1 load and connect, H2 what runs and what asks, H3 the permission
// model (P1-P5), H4 adoption and conflict, H5 /jira-status, H6 unload, the user's own server with a header secret that
// never reaches status or a script, the seven denied tools on every path (direct, model turns with Code Mode off and on,
// scripts) and their opt-in, a server that asks for a sign-in, the pinned scope and registration of the sign-in
// OpenCode starts, and the /connect entry. Each describe owns one host.
import { ROOT } from "./isolate.js"
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, mkdirSync, realpathSync } from "node:fs"
import { createServer } from "node:net"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import { Plugin } from "@opencode/plugin"
import { OAUTH_SCOPE, SUPPORTED_HOST, TESTED_HOSTS } from "../../src/constants.js"
import { DESTRUCTIVE_TOOLS, EXPORT_TOOLS, NOT_GRANTED_TOOLS, WRITE_TOOLS } from "../../src/jira-tools.js"
import { defaultRules, type Rule } from "../../src/permissions.js"
import { SKILL_NAMES } from "../../src/skills.js"
import { StatusRpc } from "../../src/status.js"
import { TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { ACCOUNT_READS, ATLASSIAN_ALL_SCOPES, ATLASSIAN_SCOPES, MODEL_ID, READ_A, READ_B } from "./fake-mcp.js"
import { agentRules, attempt, effect, HOST_VERSION, holdRoot, releaseRoot, session, startHost, until, type Host } from "./harness.js"

holdRoot()

const KEY = "sk-fake-host-test-0123456789"
const SIGN_IN = "Run /connect and choose Jira, then press o or Enter to open the link (in a terminal, opencode mcp auth jira opens it automatically; run it from the project folder, and if it answers MCP server not found: jira, wait a few seconds and run it again)."
const OFF = DESTRUCTIVE_TOOLS.join(", ").replace(/, ([^,]*)$/, " and $1")
const NOT_READ_YET = "not read yet: it appears after the first Jira call since OpenCode started"

// Starting a host takes several seconds, more on a busy machine.
setDefaultTimeout(120_000)
afterAll(releaseRoot)

const BUILT_IN = ["build", "general", "explore", "compaction", "title", "summary", "plan"]
const allow = (tool: string): Rule => ({ action: `jira_${tool}`, resource: "*", effect: "allow" })
const deny = (tool: string): Rule => ({ action: `jira_${tool}`, resource: "*", effect: "deny" })
const wildcard = (pattern: string) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)
/** The host hides a tool when the last rule matching its action is a deny on every resource. */
const hidden = (rules: readonly Rule[], action: string) => {
  const last = rules.findLast((rule) => wildcard(rule.action).test(action))
  return last?.resource === "*" && last.effect === "deny"
}

/**
 * The host lists an MCP server's tools shortly after it connects. The registry lists the denied tools too; the deny
 * hides them from the model's tools and refuses them.
 */
const jiraTools = (host: Host) =>
  until("Jira's tools are registered", async () => {
    const ids = (await host.probe().tool.list()).map((tool) => tool.id).filter((id) => id.startsWith("jira_"))
    return ids.length === 2 + ACCOUNT_READS.length + EXPORT_TOOLS.length + WRITE_TOOLS.length + DESTRUCTIVE_TOOLS.length + 1 && ids.sort()
  })

/** How many tools OpenCode lists, the one it does not know included: status counts them all. */
const AVAILABLE = 2 + ACCOUNT_READS.length + EXPORT_TOOLS.length + WRITE_TOOLS.length + DESTRUCTIVE_TOOLS.length + 1

async function status(host: Host, sessionID: string) {
  await host.client.sessions.command({ sessionID, name: "jira-status", text: "" })
  return until("/jira-status posts its text", async () => {
    const inbox = await host.client.session.inbox.list({ sessionID })
    const posted = inbox.findLast((item) => item.type === "synthetic")
    return posted?.type === "synthetic" ? posted.payload.text : undefined
  })
}

/** Enough of the tools RPC's contract for the client to call describe and the methods these tests use. */
const TOOLS_CONTRACT = {
  id: TOOLS_RPC_ID,
  methods: Object.fromEntries(["describe", READ_A, READ_B, "createJiraIssue", ...ACCOUNT_READS, ...DESTRUCTIVE_TOOLS].map((name) => [name, { input: { type: "object" }, output: { type: "object" } }])),
  events: {},
}
type ToolsClient = Record<string, (input: object, options: object) => Promise<unknown>>
const toolsRpc = (host: Host) => (host.client.rpc as unknown as (definition: object) => ToolsClient)(TOOLS_CONTRACT)
/** A session whose own rules are the grant a script needs: a blanket deny, then one allow per method it may call. */
const grantedSession = async (host: Host, permissions: Rule[]) =>
  (await host.client.sessions.create({ agent: "build", permissions, location: host.location })).id

/** A tools RPC call's output, or its error as JSON, so a test can search either for a secret. */
const scriptCall = (host: Host, method: string, input: object) =>
  toolsRpc(host)[method]!(input, { location: host.location }).then(
    (output) => JSON.stringify(output),
    (error: unknown) => JSON.stringify(error, Object.getOwnPropertyNames(error ?? {})),
  )

const statusRpc = (host: Host) => (host.client.rpc as unknown as (definition: typeof StatusRpc) => { status: (input: object, options: object) => Promise<Record<string, unknown>> })(StatusRpc).status({}, { location: host.location })

describe(`the plugin on OpenCode ${HOST_VERSION}`, () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ config: () => ({ agents: { reviewer: { description: "Reviews changes", mode: "subagent" } } }) })
  })
  afterAll(() => host?.close())

  test("the host's global folders, temp folder and working directory are inside the test's temp root", async () => {
    const global = ["XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"].map((key) => join(process.env[key]!, "opencode"))
    expect(global.filter((path) => !existsSync(path))).toEqual([])
    const { paths } = await host.client.server.info()
    const used = [...global, realpathSync(paths.tmp), process.env.OPENCODE_TEST_HOME!, tmpdir(), process.cwd()]
    expect(used.filter((path) => !path.startsWith(ROOT + sep))).toEqual([])
  })

  test("H1: the plugin is active, jira is connected, and its tools, skills and command are registered", async () => {
    const { data: plugins } = await host.client.plugin.list({ location: host.location })
    expect(plugins.find((plugin) => plugin.id === "jira.issues")?.state.status).toBe("active")
    const { data: servers } = await host.client.mcp.list({ location: host.location })
    expect(servers.find((server) => server.name === "jira")?.status).toEqual({ status: "connected" })
    expect(await jiraTools(host)).toEqual([...["shiny_new_tool", READ_A, READ_B, ...ACCOUNT_READS, ...EXPORT_TOOLS, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS].map((tool) => `jira_${tool}`)].sort())
    const { data: skills } = await host.client.skill.list({ location: host.location })
    expect(skills.map((skill) => skill.id).filter((id) => id.startsWith("jira")).sort()).toEqual([...SKILL_NAMES].sort())
    const { data: commands } = await host.client.command.list({ location: host.location })
    expect(commands.map((command) => command.name)).toContain("jira-status")
  })

  test("P1: the rules sit right after the base allow in every built-in agent, once", async () => {
    const rules = await agentRules(host)
    for (const id of BUILT_IN) {
      const permissions = rules.get(id)!
      const base = permissions.findIndex((rule) => rule.action === "*" && rule.resource === "*" && rule.effect === "allow")
      expect(base).toBe(0)
      expect(permissions.slice(base + 1, base + 1 + defaultRules().length)).toEqual(defaultRules())
      expect(permissions.filter((rule) => rule.action === "jira_*")).toHaveLength(1)
    }
  })

  test("P1: Plan and Explore are not weakened", async () => {
    expect(await effect(host, "plan", "edit")).toBe("deny")
    expect(await effect(host, "explore", `jira_${READ_A}`)).toBe("deny")
    const explore = await session(host, "explore")
    expect(await attempt(host, explore, "explore", READ_A)).toEqual({ asked: undefined, ok: false, error: `Tool.Error: Permission denied: jira_${READ_A}` })
    // Plan is not weakened: its own deny is on `edit`, so a new Jira tool runs under the default allow.
    const plan = await session(host, "plan")
    expect(await attempt(host, plan, "plan", "shiny_new_tool")).toMatchObject({ asked: undefined, ok: true })
  })

  // R18: the default is `access: "all"`, so every tool runs without a prompt, nothing is hidden, and a tool Atlassian
  // adds later is allowed at once by the namespace pattern.
  test("P2 and H2: under access all every known tool runs without a prompt, nothing is hidden, and a new tool is allowed", async () => {
    const build = await session(host)
    const before = host.fake.calls.length
    expect(await attempt(host, build, "build", READ_A)).toMatchObject({ asked: undefined, ok: true })
    for (const tool of [...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS, "shiny_new_tool"]) {
      expect({ tool, result: await attempt(host, build, "build", tool) }).toMatchObject({ tool, result: { asked: undefined, ok: true } })
    }
    expect(host.fake.calls.slice(before)).toEqual([READ_A, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS, "shiny_new_tool"])
    const rules = (await agentRules(host)).get("build")!
    expect([`jira_${READ_A}`, "jira_createJiraIssue", "jira_deleteJiraIssue", "jira_downloadJiraIssueAttachment", "jira_shiny_new_tool"].filter((action) => hidden(rules, action))).toEqual([])
    for (const tool of [...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS, "shiny_new_tool"]) expect(await effect(host, "build", `jira_${tool}`)).toBe("allow")
  })

  test("access ask-changes runs a read and refuses a change before dispatch, on the model path and the RPC path", async () => {
    const asking = await startHost({ options: { access: "ask-changes" } })
    try {
      const build = await session(asking)
      expect(await attempt(asking, build, "build", READ_A)).toMatchObject({ asked: undefined, ok: true })
      const before = asking.fake.calls.length
      for (const tool of [...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS, "shiny_new_tool"]) {
        expect({ tool, result: await attempt(asking, build, "build", tool) }).toEqual({ tool, result: { asked: `jira_${tool}`, ok: false, error: "Permission.DeclinedError: " } })
      }
      // The export class is a change too: it asks, and its rule is the same as a write's.
      expect(await effect(asking, "build", "jira_downloadJiraIssueAttachment")).toBe("ask")
      expect(asking.fake.calls.length).toBe(before)
      // A script gets the same answer: an ask is refused with no call, and the error names the rule to add.
      const refused = JSON.parse(await scriptCall(asking, "createJiraIssue", { sessionID: build, input: { query: "PROJ" } })) as { message: string }
      expect(refused.message).toContain("PERMISSION_DENIED: jira_createJiraIssue would ask")
      expect(asking.fake.calls.length).toBe(before)
    } finally {
      await asking.close()
    }
  })

  test("access read-only runs a read and denies every change, hidden from the model and refused to a script", async () => {
    const readOnly = await startHost({ options: { access: "read-only" } })
    try {
      const build = await session(readOnly)
      expect(await attempt(readOnly, build, "build", READ_A)).toMatchObject({ asked: undefined, ok: true })
      const rules = (await agentRules(readOnly)).get("build")!
      for (const tool of [...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS, "downloadJiraIssueAttachment", "shiny_new_tool"]) {
        expect({ tool, hidden: hidden(rules, `jira_${tool}`) }).toEqual({ tool, hidden: true })
        expect({ tool, effect: await effect(readOnly, "build", `jira_${tool}`) }).toEqual({ tool, effect: "deny" })
      }
      const before = readOnly.fake.calls.length
      for (const tool of [...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS]) {
        expect(await attempt(readOnly, build, "build", tool, "always")).toEqual({ asked: undefined, ok: false, error: `Tool.Error: Permission denied: jira_${tool}` })
      }
      expect(readOnly.fake.calls.length).toBe(before)
      // Status reports the value it runs under, and the destructive class as denied.
      const text = await status(readOnly, build)
      expect(text).toContain("- Access: access read-only: reads run without asking; the 14 writes and the 7 destructive tools are denied")
      expect(text).toContain(`- Tools: ${AVAILABLE} available, 1 unknown: shiny_new_tool (a tool Atlassian adds is denied); ${OFF} denied; not granted by scope: `)
    } finally {
      await readOnly.close()
    }
  })

  test("a script can call a read and a write under the default, and a session's own deny still refuses one", async () => {
    const reader = await session(host)
    const before = host.fake.calls.length
    const read = JSON.parse(await scriptCall(host, READ_A, { sessionID: reader, input: { query: "project = PROJ" } })) as { text: string }
    expect(read.text).toBe(`called ${READ_A}`)
    expect(host.fake.calls.slice(before)).toEqual([READ_A])
    // The default block allows every method, so a write needs no further rule.
    const write = JSON.parse(await scriptCall(host, "createJiraIssue", { sessionID: reader, input: { query: "PROJ" } })) as { text: string }
    expect(write.text).toBe("called createJiraIssue")
    expect(host.fake.calls.at(-1)).toBe("createJiraIssue")
    // A session's own rules come last and still win.
    const narrowed = await grantedSession(host, [{ action: "jira_createJiraIssue", resource: "*", effect: "deny" }])
    const refused = JSON.parse(await scriptCall(host, "createJiraIssue", { sessionID: narrowed, input: { query: "PROJ" } })) as { message: string }
    expect(refused.message).toContain("PERMISSION_DENIED")
  })

  test("describe with a session reports each method's class and permission, and without one no permission", async () => {
    const described = JSON.parse(await scriptCall(host, "describe", { sessionID: await session(host) })) as {
      location: string
      locationHint: string
      methods: { name: string; class: string; permission?: string }[]
    }
    const find = (name: string) => described.methods.find((method) => method.name === name)!
    expect(find(READ_A)).toMatchObject({ class: "read", permission: "allow" })
    expect(find("createJiraIssue")).toMatchObject({ class: "write", permission: "allow" })
    expect(find("downloadJiraIssueAttachment")).toMatchObject({ class: "export", permission: "allow" })
    expect(find("deleteJiraIssue")).toMatchObject({ class: "destructive", permission: "allow" })
    expect(described.location).toBe(host.location.directory)
    expect(described.locationHint).toContain("x-opencode-directory")
    const plain = JSON.parse(await scriptCall(host, "describe", {})) as { methods: { permission?: string }[] }
    expect(plain.methods.every((method) => !Object.hasOwn(method, "permission"))).toBe(true)
  })

  test("the location: describe reports where the call landed, and a call that names another location is answered there", async () => {
    const elsewhere = join(ROOT, "elsewhere")
    mkdirSync(elsewhere, { recursive: true })
    const rpc = (host.client.rpc as unknown as (definition: object) => ToolsClient)(TOOLS_CONTRACT)
    const there = (await rpc.describe!({}, { location: { directory: elsewhere } })) as { location: string }
    expect(there.location).toBe(elsewhere)
    // Without a location the call reaches the service's default location, which is why a script sends the header.
    const fallback = (await rpc.describe!({}, {})) as { location: string }
    expect(fallback.location).not.toBe(host.location.directory)
  })

  test("the destructive class is a method, describe shows it allowed by default, and a session's own deny refuses it", async () => {
    const sessionID = await session(host)
    const described = JSON.parse(await scriptCall(host, "describe", { sessionID })) as { methods: { name: string; class: string; permission: string; available?: boolean }[] }
    const denied = await grantedSession(host, DESTRUCTIVE_TOOLS.map((tool) => ({ action: `jira_${tool}`, resource: "*", effect: "deny" as const })))
    const start = host.fake.calls.length
    const narrowed = JSON.parse(await scriptCall(host, "describe", { sessionID: denied })) as { methods: { name: string; class: string; permission: string }[] }
    for (const tool of DESTRUCTIVE_TOOLS) {
      expect(described.methods.find((method) => method.name === tool)).toMatchObject({ class: "destructive", permission: "allow" })
      expect(narrowed.methods.find((method) => method.name === tool)).toMatchObject({ class: "destructive", permission: "deny" })
      const before = host.fake.calls.length
      const call = (host.client.rpc as unknown as { call: (input: object) => Promise<unknown> }).call
      const outcome = await call({ rpcID: TOOLS_RPC_ID, method: tool, input: { sessionID: denied, input: { query: "delete it" } }, location: host.location }).then(
        (output) => ({ ran: true, output }),
        (error: unknown) => ({ ran: false, error: JSON.stringify(error, Object.getOwnPropertyNames(error ?? {})) }),
      )
      expect(outcome).toMatchObject({ ran: false })
      expect(JSON.stringify(outcome)).toContain("PERMISSION_DENIED")
      expect(host.fake.calls.length).toBe(before)
      expect(host.fake.calls.slice(start)).not.toContain(tool)
    }
    // The three reads the pinned scope does not grant are methods too, and describe reports them unavailable.
    for (const tool of NOT_GRANTED_TOOLS) expect(described.methods.find((method) => method.name === tool)).toMatchObject({ class: "read", available: false })
  })

  test("P5: an agent defined only in user config gets no rules, and a change runs there under the default", async () => {
    const reviewer = (await agentRules(host)).get("reviewer")!
    expect(reviewer.some((rule) => rule.action.startsWith("jira_"))).toBe(false)
    const sessionID = await session(host, "reviewer")
    expect(await attempt(host, sessionID, "reviewer", "createJiraIssue")).toMatchObject({ asked: undefined, ok: true })
  })

  test("H5: /jira-status reports the connection, the account, the sites, the access and the tools", async () => {
    await jiraTools(host)
    const sessionID = await session(host)
    // Status makes no Atlassian call: the dialog and the command read the same model, so the count must not move.
    const before = host.fake.calls.length
    const text = await status(host, sessionID)
    expect(text).toContain(`- Connection: connected (${host.fake.url}, registered by this plugin)`)
    // Before the user's own two account reads: both rows say so, and neither has anything to show.
    expect(text).toContain(`- Account: ${NOT_READ_YET}\n`)
    expect(text).toContain(`- Sites: ${NOT_READ_YET}\n`)
    const withheld = `${NOT_GRANTED_TOOLS.slice(0, -1).join(", ")} and ${NOT_GRANTED_TOOLS.at(-1)}`
    expect(text).toContain(`- Access: access all: every Jira tool is allowed, reads and changes alike, and ${withheld} are not granted either; every agent has the block\n`)
    expect(text).toContain(`- Tools: ${AVAILABLE} available, 1 unknown: shiny_new_tool (a tool Atlassian adds is allowed at once); ${OFF} allowed like everything else; not granted by scope: `)
    expect(text).toContain("- Agents without default rules: none\n")
    expect(text).toContain("- Next step: Nothing to do.")
    expect(text).toContain(`- OpenCode: ${HOST_VERSION} (${TESTED_HOSTS.includes(HOST_VERSION) ? "tested" : "untested"}; supported range ${SUPPORTED_HOST})`)
    expect(text).not.toContain("Plan")
    const output = await statusRpc(host)
    expect(output).toMatchObject({ state: "connected", access: "all", tools: AVAILABLE, deniedTools: [...DESTRUCTIVE_TOOLS], notGranted: ["getJiraScreen", "getJiraWorkflowEditorLink", "getJiraWorkflows"], unknownCount: 1, listing: false, unguardedAgents: [] })
    expect(output).not.toHaveProperty("account")
    expect(output).toMatchObject({ sites: [] })
    // Neither the command nor the RPC, which is what the dialog asks, reached Atlassian.
    expect(host.fake.calls.length).toBe(before)

    // The user's own two account reads fill both rows, with a display name and site names and nothing else. The host's
    // executors skip execute.after hooks, so these go through the tools RPC, which records them with the same function;
    // a model turn records them through the hook, as the Code Mode describe checks.
    expect(await scriptCall(host, "atlassianUserInfo", { sessionID, input: {} })).toContain("Sam Okafor")
    expect(await scriptCall(host, "getAccessibleAtlassianResources", { sessionID, input: {} })).toContain("Acme")
    const filled = await until("/jira-status shows the account and its sites", async () => {
      const next = await status(host, sessionID)
      return next.includes("- Sites: 2 sites") ? next : undefined
    })
    expect(filled).toContain("- Account: Sam Okafor\n")
    expect(filled).toContain("- Sites: 2 sites: Acme, Sandbox\n")
    for (const shown of [filled, JSON.stringify(await statusRpc(host))]) {
      expect(shown).not.toContain("sam.okafor@example.com")
      expect(shown).not.toContain("cloud-acme")
      expect(shown).not.toContain("atlassian.net")
    }
  })

  test("H6: unloading the plugin removes the server, the rules and the command", async () => {
    // Registering a plugin with the same ID replaces the old generation, which disposes everything it registered.
    await host.client.plugin(Plugin.define({ id: "jira.issues", setup: () => {} }))
    await until("the jira server is gone", async () => {
      const { data } = await host.client.mcp.list({ location: host.location })
      return !data.some((server) => server.name === "jira")
    })
    const rules = await agentRules(host)
    for (const id of BUILT_IN) expect(rules.get(id)!.some((rule) => rule.action.startsWith("jira_"))).toBe(false)
    const { data: commands } = await host.client.command.list({ location: host.location })
    expect(commands.map((command) => command.name)).not.toContain("jira-status")
  })
})

describe("the user's own jira server, with a secret in its headers", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({
      config: (url) => ({ mcp: { servers: { jira: { type: "remote", url, oauth: false, headers: { "x-jira-test": "user", Authorization: `Bearer ${KEY}` } } } } }),
    })
  })
  afterAll(() => host?.close())

  test("H4: is adopted unchanged: the host sends its headers, and the plugin's rules still apply", async () => {
    expect(await attempt(host, await session(host), "build", READ_A)).toMatchObject({ asked: undefined, ok: true })
    expect(await attempt(host, await session(host), "build", "createJiraIssue")).toMatchObject({ asked: undefined, ok: true })
    expect(host.fake.markers.length).toBeGreaterThan(0)
    expect(new Set(host.fake.markers)).toEqual(new Set(["user"]))
    expect(new Set(host.fake.authorizations)).toEqual(new Set([`Bearer ${KEY}`]))
  })

  test("the secret never reaches /jira-status or the status RPC, which name the entry as the user's own", async () => {
    const text = await status(host, await session(host))
    expect(text).toContain(`- Connection: connected (${host.fake.url}, your own mcp.servers.jira without OAuth, used unchanged)`)
    const output = await statusRpc(host)
    expect(output).toMatchObject({ state: "connected", source: { type: "adopted", signIn: "own" } })
    // Your own entry has a scope of its own, so the plugin does not claim its scope withheld a tool.
    expect(output).toMatchObject({ notGranted: [] })
    for (const shown of [text, JSON.stringify(output)]) {
      expect(shown).not.toContain(KEY)
      expect(shown).not.toMatch(/Bearer|Authorization/i)
    }
  })

  test("the secret never reaches a script: not describe, a result or an upstream error", async () => {
    const sessionID = await session(host)
    const describe = await scriptCall(host, "describe", {})
    expect(describe).toContain(READ_A)
    const result = await scriptCall(host, READ_A, { sessionID, input: { query: "project = PROJ" } })
    expect(result).toContain(`called ${READ_A}`)
    const failure = await scriptCall(host, READ_A, { sessionID, input: { query: "fail" } })
    expect(failure).toContain("UPSTREAM_ERROR")
    for (const shown of [describe, result, failure]) {
      expect(shown).not.toContain(KEY)
      expect(shown).not.toMatch(/Bearer/i)
    }
  })
})

/** A loopback port nothing listens on yet, for a pinned callback. */
async function freePort() {
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  const { port } = server.address() as AddressInfo
  await new Promise((done) => server.close(() => done(undefined)))
  return port
}

const scripted = (host: Host) => host.client.sessions as unknown as {
  create: (input: object) => Promise<{ id: string }>
  prompt: (input: object) => Promise<unknown>
}

/** A host whose own `jira` entry points at the fake, whose model is the fake's scripted model, with Code Mode on or off. */
async function modelHost(codemode: boolean, options: { access?: "all" | "ask-changes" | "read-only" } = {}) {
  const host = await startHost({ options,
    config: (url) => ({
      mcp: { servers: { jira: { type: "remote", url, oauth: false, ...(codemode ? {} : { codemode: false }) } } },
      // No model leaves the machine: LM Studio's local API is the fake; the other local providers are off.
      providers: { lmstudio: { settings: { baseURL: `${new URL(url).origin}/v1` } }, ollama: { settings: { baseURL: "" } }, vllm: { settings: { baseURL: "" } } },
    }),
  })
  const models = host.client as unknown as { model: { list: (input: object) => Promise<{ data: { id: string; providerID: string }[] }> } }
  await until("the scripted model is listed", async () => (await models.model.list({ location: host.location })).data.find((model) => model.providerID === "lmstudio" && model.id === MODEL_ID))
  await jiraTools(host)
  return host
}

// R2 on the model path, with Code Mode off: under access read-only the model's own call to a change never reaches
// Atlassian, and the tool is not offered to it.
describe("a model turn that asks for the changes access read-only denies, with Code Mode off", () => {
  let host: Host
  beforeAll(async () => {
    host = await modelHost(false, { access: "read-only" })
  })
  afterAll(() => host?.close())

  test("the model's own calls to a denied change never reach Atlassian, and none is offered to it", async () => {
    host.fake.model.script = DESTRUCTIVE_TOOLS.map((tool) => ({ tool: `jira_${tool}`, arguments: { query: "delete it" } }))
    const before = host.fake.model.requests.length
    const sessionID = (await scripted(host).create({ agent: "build", location: host.location, model: { providerID: "lmstudio", id: MODEL_ID } })).id
    await scripted(host).prompt({ sessionID, text: "Delete the work item and tell Jira." })
    const turns = () => host.fake.model.requests.slice(before) as { tools?: { function?: { name?: string } }[]; messages?: { role: string }[] }[]
    await until("the model's final turn", async () => turns().some((request) => (request.messages ?? []).filter((message) => message.role === "tool").length >= DESTRUCTIVE_TOOLS.length))
    const offered = turns().flatMap((request) => (request.tools ?? []).map((item) => item.function?.name ?? ""))
    expect(offered.filter((name) => name.startsWith("jira_"))).toContain(`jira_${READ_B}`)
    for (const tool of DESTRUCTIVE_TOOLS) {
      expect(offered).not.toContain(`jira_${tool}`)
      expect(host.fake.calls).not.toContain(tool)
    }
  })

  test("the model's own account reads fill the Account and Sites rows through the execute.after hook", async () => {
    host.fake.model.script = ACCOUNT_READS.map((tool) => ({ tool: `jira_${tool}`, arguments: {} }))
    const before = host.fake.model.requests.length
    const sessionID = (await scripted(host).create({ agent: "build", location: host.location, model: { providerID: "lmstudio", id: MODEL_ID } })).id
    await scripted(host).prompt({ sessionID, text: "Which Jira site am I on?" })
    await until("the model's final turn", async () =>
      host.fake.model.requests.slice(before).some((request) => ((request as { messages?: { role: string }[] }).messages ?? []).filter((message) => message.role === "tool").length >= ACCOUNT_READS.length),
    )
    for (const tool of ACCOUNT_READS) expect(host.fake.calls).toContain(tool)
    const text = await until("status shows the account and its sites", async () => {
      const posted = await status(host, await session(host))
      return posted.includes("- Sites: 2 sites") ? posted : undefined
    })
    expect(text).toContain("- Account: Sam Okafor\n")
    expect(text).toContain("- Sites: 2 sites: Acme, Sandbox\n")
    for (const secret of ["sam.okafor@example.com", "cloud-acme", "atlassian.net"]) expect(text).not.toContain(secret)
  })
})

// R2 on the Code Mode path: inside `execute`, under access read-only, a read runs, and a change or an unknown name is
// denied inside the program and never reaches Atlassian.
describe("a Code Mode turn that asks for the changes access read-only denies", () => {
  let host: Host
  beforeAll(async () => {
    host = await modelHost(true, { access: "read-only" })
  })
  afterAll(() => host?.close())

  test("an inner tools.jira call to a denied change or an unknown name fails inside the program and never reaches Atlassian; a read runs", async () => {
    const code = [
      "const results = []",
      `for (const name of ${JSON.stringify([...DESTRUCTIVE_TOOLS, ...WRITE_TOOLS, "shiny_new_tool"])}) {`,
      "  try { await tools.jira[name]({ query: 'run it' }); results.push(name + ': ran') } catch (error) { results.push(name + ': refused') }",
      "}",
      `results.push(String((await tools.jira.${READ_B}({})) !== undefined))`,
      "return results",
    ].join("\n")
    host.fake.model.script = [{ tool: "execute", arguments: { code } }]
    const before = host.fake.model.requests.length
    const sessionID = (await scripted(host).create({ agent: "build", location: host.location, model: { providerID: "lmstudio", id: MODEL_ID } })).id
    await scripted(host).prompt({ sessionID, text: "Delete the work item and tell Atlassian." })
    await until("the model's final turn", async () => host.fake.model.requests.slice(before).some((request) => (request as { messages?: { role: string }[] }).messages?.some((message) => message.role === "tool")))
    expect(host.fake.calls).toContain(READ_B)
    for (const tool of [...DESTRUCTIVE_TOOLS, ...WRITE_TOOLS]) expect(host.fake.calls).not.toContain(tool)
  })
})

// R2 on the Code Mode path: under access ask-changes, a program's own call to a change asks, as it does on the direct
// path. The program reports its own start with a read, so the test can tell "the write was refused" from "the program
// never ran".
describe("a Code Mode turn where access ask-changes asks for a change", () => {
  let host: Host
  beforeAll(async () => {
    host = await modelHost(true, { access: "ask-changes" })
  })
  afterAll(() => host?.close())

  test("a program's own call to a change asks, and a declined ask stops it before Atlassian is reached", async () => {
    const code = [
      `await tools.jira.${READ_B}({ query: 'started' })`,
      "await tools.jira.createJiraIssue({ query: 'create it' })",
      `await tools.jira.${READ_B}({ query: 'after the write' })`,
    ].join("\n")
    host.fake.model.script = [{ tool: "execute", arguments: { code } }]
    const before = host.fake.calls.length
    const sessionID = (await scripted(host).create({ agent: "build", location: host.location, model: { providerID: "lmstudio", id: MODEL_ID } })).id
    const prompt = scripted(host).prompt({ sessionID, text: "Create a work item for the flaky login test." })
    const request = await until("the change asks inside the program", async () =>
      (await host.client.permission.list({ sessionID })).find((item) => item.action === "jira_createJiraIssue"),
    )
    expect(request.action).toBe("jira_createJiraIssue")
    await host.client.permission.reply({ sessionID, requestID: request.id, decision: "reject" })
    await prompt
    // The read before the write ran; the write never reached the fake; and the program did not go on past the refusal.
    expect(host.fake.calls.slice(before)).toEqual([READ_B])
    expect(host.fake.called.filter((call) => call.tool === "createJiraIssue")).toEqual([])
    expect(await host.client.permission.list({ sessionID })).toEqual([])
  })
})

describe("the documented opt-in for a destructive tool under read-only", () => {
  // The recipe the configuration guide gives: the ask goes in the agent's own permissions, which come after the
  // plugin's block in that agent, so it turns one tool back on without reopening the rest.
  const optIn: Rule = { action: "jira_deleteJiraIssue", resource: "*", effect: "ask" }
  let host: Host
  beforeAll(async () => {
    host = await startHost({ options: { access: "read-only" }, config: () => ({ agents: { build: { permissions: [optIn] } } }) })
  })
  afterAll(() => host?.close())

  test("turns that one tool into a per-call ask in that agent, never an allow, and leaves the rest denied", async () => {
    await jiraTools(host)
    const rules = (await agentRules(host)).get("build")!
    expect(rules.indexOf(rules.find((rule) => JSON.stringify(rule) === JSON.stringify(optIn))!)).toBeGreaterThan(rules.findIndex((rule) => rule.action === "jira_deleteJiraIssue" && rule.effect === "deny"))
    expect(await effect(host, "build", "jira_deleteJiraIssue")).toBe("ask")
    const build = await session(host)
    expect(await attempt(host, build, "build", "deleteJiraIssue")).toEqual({ asked: "jira_deleteJiraIssue", ok: false, error: "Permission.DeclinedError: " })
    expect(host.fake.calls).not.toContain("deleteJiraIssue")
    // Each call asks again: a "once" answer runs one call and saves nothing.
    expect(await attempt(host, build, "build", "deleteJiraIssue", "once")).toMatchObject({ asked: "jira_deleteJiraIssue", ok: true })
    expect(await attempt(host, build, "build", "deleteJiraIssue")).toMatchObject({ asked: "jira_deleteJiraIssue", ok: false })
    // The other agents, Explore included, and the other six tools stay denied.
    for (const id of BUILT_IN.filter((id) => id !== "build")) expect({ id, effect: await effect(host, id, "jira_deleteJiraIssue") }).toEqual({ id, effect: "deny" })
    for (const tool of DESTRUCTIVE_TOOLS.filter((tool) => tool !== "deleteJiraIssue")) expect(await effect(host, "build", `jira_${tool}`)).toBe("deny")
  })
})

describe("user permissions", () => {
  const userRules = [allow("createJiraIssue"), deny(READ_A)]
  let host: Host
  beforeAll(async () => {
    host = await startHost({
      config: () => ({
        permissions: userRules,
        // The documented fix for a config-only agent: the plugin's block first, then the user's rules again.
        agents: { reviewer: { description: "Reviews changes", mode: "subagent", permissions: [...defaultRules(), ...userRules] } },
      }),
    })
  })
  afterAll(() => host?.close())

  test("P3: a user allow on a change removes the prompt, and a user deny on a read hides it", async () => {
    const build = await session(host)
    expect(await attempt(host, build, "build", "createJiraIssue")).toMatchObject({ asked: undefined, ok: true })
    expect(await attempt(host, build, "build", READ_A)).toEqual({ asked: undefined, ok: false, error: `Tool.Error: Permission denied: jira_${READ_A}` })
    expect(hidden((await agentRules(host)).get("build")!, `jira_${READ_A}`)).toBe(true)
    // The user's rules win both ways; a tool the user says nothing about runs under the default `all`.
    expect(await attempt(host, build, "build", "shiny_new_tool")).toMatchObject({ asked: undefined, ok: true })
  })

  test("P5: the per-agent fix puts the block in a config-only agent and keeps the user's rules winning", async () => {
    const reviewer = await session(host, "reviewer")
    expect(await attempt(host, reviewer, "reviewer", "shiny_new_tool")).toMatchObject({ asked: undefined, ok: true })
    expect(await attempt(host, reviewer, "reviewer", "createJiraIssue")).toMatchObject({ asked: undefined, ok: true })
    expect(await attempt(host, reviewer, "reviewer", READ_A)).toMatchObject({ asked: undefined, ok: false })
    expect(await status(host, reviewer)).toContain("- Agents without default rules: none\n")
  })
})

describe("a user jira server that points elsewhere", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ config: (url) => ({ mcp: { servers: { jira: { type: "remote", url: url.replace(/\/mcp$/, "/other"), oauth: false } } } }) })
  })
  afterAll(() => host?.close())

  test("H4: is left in place and reported as a conflict", async () => {
    const text = await status(host, await session(host))
    const other = host.fake.url.replace(/\/mcp$/, "/other")
    expect(text).toContain(`- Connection: conflict (your mcp.servers.jira points at ${other})`)
    expect(text).toContain(`- Next step: Your OpenCode config defines mcp.servers.jira with ${other}, but the plugin uses ${host.fake.url}.`)
  })
})

// Atlassian's server answers 401 with a bearer challenge until the user signs in, or after its tokens are revoked. On
// the host's own MCP client that is a sign-in, not a failure: status says so, with the /connect step.
describe("a server that asks for a sign-in", () => {
  let host: Host
  beforeAll(async () => {
    // A token without a refresh token: a 401 then needs a new sign-in and keeps the credential, which is the account
    // /connect marks.
    host = await startHost({ oauth: true, fake: { refreshTokens: false } })
  })
  afterAll(() => host?.close())

  /** The /connect entry's connections, with the status a credential shows there. */
  const connections = async () => {
    const { data: servers } = await host.client.mcp.list({ location: host.location })
    const integrationID = servers.find((item) => item.name === "jira")?.integrationID
    if (!integrationID) return []
    const { data } = await host.client.integration.get({ integrationID, location: host.location })
    return (data as unknown as { connections?: { status?: { status: string; message?: string } }[] }).connections ?? []
  }

  /** Signs in through OpenCode's own flow: it registers, the authorization endpoint redirects the loopback callback, and the token endpoint exchanges the code. */
  const signIn = async () => {
    const { data: servers } = await host.client.mcp.list({ location: host.location })
    const integrationID = servers.find((item) => item.name === "jira")!.integrationID!
    const { data: integration } = await host.client.integration.get({ integrationID, location: host.location })
    const oauth = (host.client.integration as unknown as { oauth: Record<"connect", (input: object) => Promise<{ data: { attemptID: string; url: string } }>> }).oauth
    const { data: attempt } = await oauth.connect({ integrationID, methodID: (integration.methods as { id: string }[])[0]!.id, location: host.location })
    const redirect = await fetch(attempt.url, { redirect: "manual" })
    const callback = redirect.headers.get("location")
    expect(callback).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
    await fetch(callback!)
  }

  test("is sign-in required, with the /connect next step, in the RPC and in /jira-status", async () => {
    await jiraTools(host)
    expect(await statusRpc(host)).toMatchObject({ state: "connected" })
    // A real sign-in leaves a credential: the account /connect marks when Atlassian stops accepting it.
    host.fake.challenge = true
    await signIn()
    await until("the sign-in stores a token", async () => host.fake.tokens.length === 1)
    expect(host.fake.tokens[0]).toMatchObject({ grant_type: "authorization_code" })
    expect(host.fake.tokens[0]).not.toHaveProperty("refresh_token")
    host.fake.challenge = false
    await until("the server is connected after the sign-in", async () => {
      const { data } = await host.client.mcp.list({ location: host.location })
      return data.find((item) => item.name === "jira")?.status.status === "connected"
    })
    expect(await until("/connect shows the account", async () => (await connections()).find((item) => item.status?.message === undefined && (item as { type?: string }).type === "credential")))
    // The tokens stop working: the next connection gets the challenge.
    host.fake.challenge = true
    const mcp = host.client.mcp as unknown as Record<"connect" | "disconnect", (input: object) => Promise<unknown>>
    await mcp.disconnect({ server: "jira", location: host.location })
    await mcp.connect({ server: "jira", location: host.location }).catch(() => {})
    const server = await until("the server needs a sign-in", async () => {
      const { data } = await host.client.mcp.list({ location: host.location })
      const found = data.find((item) => item.name === "jira")
      return found?.status.status === "needs_auth" ? found : undefined
    })
    expect(server.status.status).toBe("needs_auth")
    // The plugin marks the /connect account, so the person sees which one to choose there.
    expect(await until("/connect shows the new sign-in on the account", async () => (await connections()).find((item) => item.status?.message === "Jira needs a new sign-in. Choose this account to sign in again.")))
    expect(await statusRpc(host)).toMatchObject({ state: "sign_in_required", nextStep: SIGN_IN })
    const text = await status(host, await session(host))
    expect(text).toContain(`- Connection: sign-in required (${host.fake.url}, registered by this plugin)`)
    expect(text).toContain(`- Next step: ${SIGN_IN}`)
    expect(text).not.toMatch(/authorize|code_challenge/)
    // The same account connects again once Atlassian answers: the mark is the plugin's, and it clears its own.
    host.fake.challenge = false
    await mcp.connect({ server: "jira", location: host.location })
    await until("the server is connected again", async () => {
      const { data } = await host.client.mcp.list({ location: host.location })
      return data.find((item) => item.name === "jira")?.status.status === "connected"
    })
    expect(await until("/connect clears the sign-in mark", async () => ((await connections()).some((item) => item.status?.message) ? undefined : true))).toBe(true)
  })
})

// The plugin registers the server with the scope pinned, because Atlassian's 401 names none. The sign-in OpenCode
// starts must carry it in both the client registration and the authorization request.
describe("the sign-in OpenCode starts", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ oauth: true })
  })
  afterAll(() => host?.close())

  // The 401 names no scope and the metadata lists about 40, so the pin is what keeps the grant to Jira read, write and
  // search: without it these two assertions see the whole list.
  test("registers a client dynamically and asks exactly the pinned scope, not the 40 the metadata advertises", async () => {
    await jiraTools(host)
    host.fake.challenge = true
    const { data: servers } = await host.client.mcp.list({ location: host.location })
    const integrationID = servers.find((item) => item.name === "jira")?.integrationID
    expect(integrationID).toBeDefined()
    const { data: integration } = await host.client.integration.get({ integrationID: integrationID!, location: host.location })
    const methodID = (integration.methods as { id: string }[])[0]!.id
    const oauth = (host.client.integration as unknown as { oauth: Record<"connect" | "cancel", (input: object) => Promise<{ data: { attemptID: string; url: string } }>> }).oauth
    const { data: attempt } = await oauth.connect({ integrationID, methodID, location: host.location })
    try {
      const url = new URL(attempt.url)
      expect(`${url.origin}${url.pathname}`).toBe(`${host.fake.origin}/oidc/auth`)
      expect(url.searchParams.get("scope")).toBe(OAUTH_SCOPE)
      expect(url.searchParams.get("scope")).not.toBe(ATLASSIAN_ALL_SCOPES.join(" "))
      expect(OAUTH_SCOPE.split(" ").filter((scope) => !ATLASSIAN_ALL_SCOPES.includes(scope))).toEqual([])
      expect(OAUTH_SCOPE).not.toMatch(/delete:|manage:|confluence|twg|jsm|rovo|search:code/)
      // The fake advertises the whole list, as Atlassian's metadata does, and the plugin's pin is what narrows it.
      expect(ATLASSIAN_ALL_SCOPES.length).toBeGreaterThan(OAUTH_SCOPE.split(" ").length)
      expect(ATLASSIAN_SCOPES).toBe(OAUTH_SCOPE)
      expect(url.searchParams.get("code_challenge_method")).toBe("S256")
      expect(url.searchParams.get("client_id")).toBe("fake-client-1")
      expect(url.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
      expect(host.fake.registrations).toHaveLength(1)
      expect(host.fake.registrations[0]).toMatchObject({
        client_name: "opencode",
        scope: OAUTH_SCOPE,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      })
    } finally {
      await oauth.cancel({ integrationID, attemptID: attempt.attemptID, location: host.location }).catch(() => {})
    }
  })
})

// The documented remedy for Jira's one real sign-in risk: pin the callback, which turns the client ID metadata document
// off and makes OpenCode register that exact loopback URL dynamically. The fake advertises CIMD, as Atlassian does, so
// this is a fallback and not the only path it has.
describe("the redirect_uri fallback when a loopback port is refused", () => {
  let host: Host
  let port: number
  const callback = () => `http://127.0.0.1:${port}/callback`
  beforeAll(async () => {
    port = await freePort()
    host = await startHost({
      oauth: true,
      fake: { cimd: true },
      config: (url) => ({ mcp: { servers: { jira: { type: "remote", url, oauth: { scope: OAUTH_SCOPE, redirect_uri: callback(), callback_port: port } } } } }),
    })
  })
  afterAll(() => host?.close())

  test("adopts the entry, registers that exact callback dynamically, and completes the sign-in", async () => {
    await jiraTools(host)
    host.fake.challenge = true
    const { data: servers } = await host.client.mcp.list({ location: host.location })
    const integrationID = servers.find((item) => item.name === "jira")?.integrationID
    expect(integrationID).toBeDefined()
    const { data: integration } = await host.client.integration.get({ integrationID: integrationID!, location: host.location })
    // The entry is adopted, not replaced: status names it as the user's own, with OAuth.
    expect(await statusRpc(host)).toMatchObject({ source: { type: "adopted", signIn: "oauth" } })
    const oauth = (host.client.integration as unknown as { oauth: Record<"connect", (input: object) => Promise<{ data: { attemptID: string; url: string } }>> }).oauth
    const { data: attempt } = await oauth.connect({ integrationID: integrationID!, methodID: (integration.methods as { id: string }[])[0]!.id, location: host.location })
    const url = new URL(attempt.url)
    expect(url.searchParams.get("redirect_uri")).toBe(callback())
    // A registered client, with the pinned URL, rather than OpenCode's client document.
    expect(url.searchParams.get("client_id")).toBe("fake-client-1")
    expect(host.fake.registrations).toHaveLength(1)
    expect(host.fake.registrations[0]).toMatchObject({ redirect_uris: [callback()], scope: OAUTH_SCOPE, token_endpoint_auth_method: "none" })
    // The browser comes back to the port the user pinned, and the sign-in completes.
    const redirect = await fetch(attempt.url, { redirect: "manual" })
    const target = redirect.headers.get("location")
    expect(target).toMatch(new RegExp(`^${callback().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?`))
    await fetch(target!)
    await until("the token is exchanged", async () => host.fake.tokens.find((token) => token.grant_type === "authorization_code"))
    host.fake.challenge = false
    await until("the server is connected after the fallback sign-in", async () => {
      const { data } = await host.client.mcp.list({ location: host.location })
      return data.find((item) => item.name === "jira")?.status.status === "connected"
    })
    expect(await statusRpc(host)).toMatchObject({ state: "connected", source: { type: "adopted", signIn: "oauth" } })
  })
})

describe("the /connect entry", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ oauth: true })
  })
  afterAll(() => host?.close())

  const entry = async () => {
    const { data } = await host.client.mcp.list({ location: host.location })
    const integrationID = data.find((server) => server.name === "jira")?.integrationID
    if (!integrationID) return undefined
    return (await host.client.integration.get({ integrationID, location: host.location })).data
  }

  test("is named Jira, also after the host reloads its MCP servers", async () => {
    expect((await until("the entry is named Jira", async () => ((await entry())?.name === "Jira" ? entry() : undefined)))?.methods).toHaveLength(1)
    await host.probe().mcp.reload()
    await until("the entry is named Jira again after the reload", async () => (await entry())?.name === "Jira")
    await Bun.sleep(1000)
    expect((await entry())?.name).toBe("Jira")
  })
})
