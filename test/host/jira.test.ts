// The plugin on the public @opencode/sdk host: H1 load and connect, H2 what runs and what asks, H3 the permission
// model (P1-P5), H4 adoption and conflict, H5 /jira-status, H6 unload, the user's own server with a header secret that
// never reaches status or a script, the seven denied tools on every path (direct, model turns with Code Mode off and on,
// scripts) and their opt-in, a server that asks for a sign-in, the pinned scope and registration of the sign-in
// OpenCode starts, and the /connect entry. Each describe owns one host.
import { ROOT } from "./isolate.js"
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import { Plugin } from "@opencode/plugin"
import { OAUTH_SCOPE, SUPPORTED_HOST, TESTED_HOSTS } from "../../src/constants.js"
import { DENY_TOOLS, WRITE_TOOLS } from "../../src/jira-tools.js"
import { defaultRules, type Rule } from "../../src/permissions.js"
import { SKILL_NAMES } from "../../src/skills.js"
import { StatusRpc } from "../../src/status.js"
import { TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { ACCOUNT_READS, ATLASSIAN_ALL_SCOPES, ATLASSIAN_SCOPES, MODEL_ID, READ_A, READ_B } from "./fake-mcp.js"
import { agentRules, attempt, cleanup, effect, HOST_VERSION, session, startHost, until, type Host } from "./harness.js"

const AGENT_RULES = defaultRules().map((rule, index, rules) => `  ${JSON.stringify(rule)}${index < rules.length - 1 ? "," : ""}`).join("\n")
const AGENTS_NEXT_STEP = "Put the default rules shown by /jira-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Jira tools."
const KEY = "sk-fake-host-test-0123456789"
const SIGN_IN = "Run /connect and choose Jira, then press o or Enter to open the link (in a terminal, opencode mcp auth jira opens it automatically)."
const OFF = DENY_TOOLS.join(", ").replace(/, ([^,]*)$/, " and $1")
const NOT_READ_YET = "not read yet: it appears after the first Jira call since OpenCode started"

// Starting a host takes several seconds, more on a busy machine.
setDefaultTimeout(120_000)
afterAll(cleanup)

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
    return ids.length === 2 + ACCOUNT_READS.length + WRITE_TOOLS.length + DENY_TOOLS.length + 1 && ids.sort()
  })

/** How many listed tools the default rules let run or ask: every listed tool except the denied ones. */
const AVAILABLE = 2 + ACCOUNT_READS.length + WRITE_TOOLS.length + 1

async function status(host: Host, sessionID: string) {
  await host.client.sessions.command({ sessionID, name: "jira-status", text: "" })
  return until("/jira-status posts its text", async () => {
    const inbox = await host.client.session.inbox.list({ sessionID })
    const posted = inbox.findLast((item) => item.type === "synthetic")
    return posted?.type === "synthetic" ? posted.payload.text : undefined
  })
}

/** Enough of the tools RPC's contract for the client to call describe, the account reads and two known reads. */
const TOOLS_CONTRACT = {
  id: TOOLS_RPC_ID,
  methods: Object.fromEntries(["describe", READ_A, READ_B, ...ACCOUNT_READS].map((name) => [name, { input: { type: "object" }, output: { type: "object" } }])),
  events: {},
}
type ToolsClient = Record<string, (input: object, options: object) => Promise<unknown>>
const toolsRpc = (host: Host) => (host.client.rpc as unknown as (definition: object) => ToolsClient)(TOOLS_CONTRACT)
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
    expect(await jiraTools(host)).toEqual([...["shiny_new_tool", READ_A, READ_B, ...ACCOUNT_READS, ...WRITE_TOOLS, ...DENY_TOOLS].map((tool) => `jira_${tool}`)].sort())
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
    const plan = await session(host, "plan")
    expect(await attempt(host, plan, "plan", "shiny_new_tool")).toMatchObject({ asked: "jira_shiny_new_tool", ok: false })
  })

  test("P2 and H2: known reads run without a prompt, everything else asks, and the seven denied tools are hidden", async () => {
    const build = await session(host)
    const before = host.fake.calls.length
    expect(await attempt(host, build, "build", READ_A)).toMatchObject({ asked: undefined, ok: true })
    expect(await attempt(host, build, "build", "shiny_new_tool")).toEqual({ asked: "jira_shiny_new_tool", ok: false, error: "Permission.DeclinedError: " })
    // Every known write asks, and a declined ask never reaches Atlassian.
    for (const tool of WRITE_TOOLS) {
      expect({ tool, result: await attempt(host, build, "build", tool) }).toEqual({ tool, result: { asked: `jira_${tool}`, ok: false, error: "Permission.DeclinedError: " } })
    }
    expect(host.fake.calls.slice(before)).toEqual([READ_A])
    const rules = (await agentRules(host)).get("build")!
    expect([`jira_${READ_A}`, "jira_createJiraIssue", "jira_shiny_new_tool"].filter((action) => hidden(rules, action))).toEqual([])
    // Each denied tool is hidden, refused with no prompt even when "always" would be the answer, and never reaches
    // Atlassian, in every built-in agent.
    const all = await agentRules(host)
    for (const tool of DENY_TOOLS) {
      for (const id of BUILT_IN) expect({ id, tool, hidden: hidden(all.get(id)!, `jira_${tool}`) }).toEqual({ id, tool, hidden: true })
      expect(await effect(host, "build", `jira_${tool}`)).toBe("deny")
      expect(await attempt(host, build, "build", tool, "always")).toEqual({ asked: undefined, ok: false, error: `Tool.Error: Permission denied: jira_${tool}` })
      expect(host.fake.calls).not.toContain(tool)
    }
  })

  test("no script reaches a denied tool: the tools RPC has no such method, and describe never lists one", async () => {
    const sessionID = await session(host)
    const described = await scriptCall(host, "describe", {})
    for (const tool of DENY_TOOLS) {
      expect(described).not.toContain(tool)
      const call = (host.client.rpc as unknown as { call: (input: object) => Promise<unknown> }).call
      const outcome = await call({ rpcID: TOOLS_RPC_ID, method: tool, input: { sessionID, input: { query: "delete it" } }, location: host.location }).then(
        (output) => ({ ran: true, output }),
        (error: unknown) => ({ ran: false, error: JSON.stringify(error, Object.getOwnPropertyNames(error ?? {})) }),
      )
      expect(outcome).toMatchObject({ ran: false })
      expect(host.fake.calls).not.toContain(tool)
    }
    // The three reads the pinned scope does not grant are not methods either.
    for (const tool of ["getJiraWorkflows", "getJiraWorkflowEditorLink", "getJiraScreen"]) expect(described).not.toContain(`"${tool}"`)
  })

  test("P4: a saved 'Always allow' removes the prompt", async () => {
    const build = await session(host)
    expect(await attempt(host, build, "build", "shiny_new_tool", "always")).toMatchObject({ asked: "jira_shiny_new_tool", ok: true })
    expect(await attempt(host, build, "build", "shiny_new_tool")).toMatchObject({ asked: undefined, ok: true })
    const { projectID } = await host.client.sessions.get({ sessionID: build })
    const saved = await host.client.permission.saved.list({ projectID })
    expect(saved.map(({ action, resource }) => ({ action, resource }))).toEqual([{ action: "jira_shiny_new_tool", resource: "*" }])
  })

  test("P5: an agent defined only in user config gets no rules, and Jira tools run there unprompted", async () => {
    const reviewer = (await agentRules(host)).get("reviewer")!
    expect(reviewer.some((rule) => rule.action.startsWith("jira_"))).toBe(false)
    const sessionID = await session(host, "reviewer")
    expect(await attempt(host, sessionID, "reviewer", "createJiraIssue")).toMatchObject({ asked: undefined, ok: true })
  })

  test("H5: /jira-status reports the connection, the account, the sites, the tools and the unguarded agent's fix", async () => {
    await jiraTools(host)
    const sessionID = await session(host)
    const text = await status(host, sessionID)
    expect(text).toContain(`- Connection: connected (${host.fake.url}, registered by this plugin)`)
    // Before the user's own two account reads: both rows say so, and neither has anything to show.
    expect(text).toContain(`- Account: ${NOT_READ_YET}\n`)
    expect(text).toContain(`- Sites: ${NOT_READ_YET}\n`)
    expect(text).toContain(`- Access: reads run without asking; the ${WRITE_TOOLS.length} changes ask first; ${DENY_TOOLS.length} tools are off, and the deletes and the project and screen settings are not granted either; default rules missing in the agents listed below\n`)
    expect(text).toContain(`- Tools: ${AVAILABLE} available, 1 unknown: shiny_new_tool (unknown tools ask before running); off by default: ${OFF}; not granted by scope: `)
    expect(text).toContain(`- Agents without default rules: reviewer\n${AGENT_RULES}\n`)
    expect(text).toContain(`- Next step: ${AGENTS_NEXT_STEP}`)
    expect(text).toContain(`- OpenCode: ${HOST_VERSION} (${TESTED_HOSTS.includes(HOST_VERSION) ? "tested" : "untested"}; supported range ${SUPPORTED_HOST})`)
    expect(text).not.toContain("Plan")
    const output = await statusRpc(host)
    expect(output).toMatchObject({ state: "connected", tools: AVAILABLE, deniedTools: [...DENY_TOOLS], notGranted: ["getJiraScreen", "getJiraWorkflowEditorLink", "getJiraWorkflows"], unknownCount: 1, listing: false, unguardedAgents: ["reviewer"] })
    expect(output).not.toHaveProperty("account")
    expect(output).toMatchObject({ sites: [] })

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
    expect(await attempt(host, await session(host), "build", "createJiraIssue")).toMatchObject({ asked: "jira_createJiraIssue", ok: false })
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

const scripted = (host: Host) => host.client.sessions as unknown as {
  create: (input: object) => Promise<{ id: string }>
  prompt: (input: object) => Promise<unknown>
}

/** A host whose own `jira` entry points at the fake, whose model is the fake's scripted model, with Code Mode on or off. */
async function modelHost(codemode: boolean) {
  const host = await startHost({
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

describe("a model turn that asks for the denied tools, with Code Mode off", () => {
  let host: Host
  beforeAll(async () => {
    host = await modelHost(false)
  })
  afterAll(() => host?.close())

  test("the model's own calls to the denied tools never reach Atlassian, and none is offered to it", async () => {
    host.fake.model.script = DENY_TOOLS.map((tool) => ({ tool: `jira_${tool}`, arguments: { query: "delete it" } }))
    const before = host.fake.model.requests.length
    const sessionID = (await scripted(host).create({ agent: "build", location: host.location, model: { providerID: "lmstudio", id: MODEL_ID } })).id
    await scripted(host).prompt({ sessionID, text: "Delete the work item and tell Jira." })
    const turns = () => host.fake.model.requests.slice(before) as { tools?: { function?: { name?: string } }[]; messages?: { role: string }[] }[]
    await until("the model's final turn", async () => turns().some((request) => (request.messages ?? []).filter((message) => message.role === "tool").length >= DENY_TOOLS.length))
    const offered = turns().flatMap((request) => (request.tools ?? []).map((item) => item.function?.name ?? ""))
    expect(offered.filter((name) => name.startsWith("jira_"))).toContain(`jira_${READ_B}`)
    for (const tool of DENY_TOOLS) {
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

describe("a Code Mode turn that asks for the denied tools", () => {
  let host: Host
  beforeAll(async () => {
    host = await modelHost(true)
  })
  afterAll(() => host?.close())

  test("an inner tools.jira call to a denied tool fails inside the program and never reaches Atlassian; a read runs", async () => {
    const code = [
      "const results = []",
      `for (const name of ${JSON.stringify(DENY_TOOLS)}) {`,
      "  try { await tools.jira[name]({ query: 'delete it' }); results.push(name + ': ran') } catch (error) { results.push(name + ': refused') }",
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
    for (const tool of DENY_TOOLS) expect(host.fake.calls).not.toContain(tool)
  })
})

describe("the documented opt-in for a denied tool", () => {
  // DP-1's recipe: the ask goes in the agent's own permissions, which come after the plugin's block in that agent.
  const optIn: Rule = { action: "jira_deleteJiraIssue", resource: "*", effect: "ask" }
  let host: Host
  beforeAll(async () => {
    host = await startHost({ config: () => ({ agents: { build: { permissions: [optIn] } } }) })
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
    for (const tool of DENY_TOOLS.filter((tool) => tool !== "deleteJiraIssue")) expect(await effect(host, "build", `jira_${tool}`)).toBe("deny")
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
    expect(await attempt(host, build, "build", "shiny_new_tool")).toMatchObject({ asked: "jira_shiny_new_tool", ok: false })
  })

  test("P5: the per-agent fix guards a config-only agent and keeps the user's rules winning", async () => {
    const reviewer = await session(host, "reviewer")
    expect(await attempt(host, reviewer, "reviewer", "shiny_new_tool")).toMatchObject({ asked: "jira_shiny_new_tool", ok: false })
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
