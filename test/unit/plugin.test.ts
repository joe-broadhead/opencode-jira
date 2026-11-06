import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Plugin } from "@opencode/plugin"
import { ENDPOINT, NAMESPACE_DESCRIPTION, OAUTH_SCOPE } from "../../src/constants.js"
import jira from "../../src/index.js"
import { createJiraPlugin, displayUrl, registerServer, scopeOf, serverConfig } from "../../src/plugin.js"
import { SKILL_NAMES } from "../../src/skills.js"
import type { ServerSource } from "../../src/status.js"
import { agentEditor, builtInAgents, mcpEditor, transforms, type McpEditor } from "./fake.js"

const skillsDir = mkdtempSync(join(tmpdir(), "jira-skills-"))
afterAll(() => rmSync(skillsDir, { recursive: true, force: true }))
for (const name of SKILL_NAMES) {
  mkdirSync(join(skillsDir, name))
  writeFileSync(join(skillsDir, name, "SKILL.md"), `---\nname: ${name}\ndescription: Use Jira.\n---\nBody.\n`)
}
const seam = { endpoint: ENDPOINT, skillsDir }
const KEY = "sk-fake-0123456789"

async function register(initial: Parameters<typeof mcpEditor>[0] = {}) {
  const { transform, run } = transforms<McpEditor>()
  const records: [ServerSource | undefined, string | undefined][] = []
  await registerServer({ transform }, serverConfig(seam), (source, problem) => records.push([source, problem]))
  const { editor, servers } = mcpEditor(initial)
  run(editor)
  return { servers, records }
}

describe("the jira server", () => {
  test("is Atlassian's flat-list server with the scope pinned, and no client id or redirect, so OpenCode's own client document is used", () => {
    expect(serverConfig(seam)).toEqual({ type: "remote", url: ENDPOINT, oauth: { scope: OAUTH_SCOPE } })
    // A pinned client_id or redirect_uri would turn the client ID metadata document off and force dynamic registration.
    expect(serverConfig(seam).oauth).toEqual({ scope: OAUTH_SCOPE })
    expect(Object.keys(serverConfig(seam).oauth as object)).toEqual(["scope"])
    // Jira only, with no delete and no manage scope: the second, server-side copy of the plugin's deny list.
    expect(OAUTH_SCOPE.split(" ")).toEqual(["read:me", "read:account", "offline_access", "read:jira:agent-interface", "write:jira:agent-interface", "search:jira:agent-interface"])
    expect(OAUTH_SCOPE).not.toMatch(/delete:|manage:|:confluence:|twg|search:code|rovo/)
    expect(serverConfig({ endpoint: "http://127.0.0.1:1/mcp", oauth: false })).toEqual({ type: "remote", url: "http://127.0.0.1:1/mcp", oauth: false })
  })

  test("is registered under the stable name when the user has none", async () => {
    const { servers, records } = await register({ github: { type: "remote", url: "https://example.com/mcp" } })
    expect(servers.get("jira")).toEqual(serverConfig(seam))
    expect(servers.get("github")).toEqual({ type: "remote", url: "https://example.com/mcp" })
    expect(records).toEqual([[{ type: "plugin", url: ENDPOINT, signIn: "oauth" }, undefined]])
  })

  test("adopts the user's own server at Atlassian's URL unchanged, query included, with OAuth settings or its own headers", async () => {
    const own = { type: "remote" as const, url: "https://mcp.atlassian.com/v2/mcp/?tools=all", oauth: { client_id: "pre-registered", callback_port: 19876 }, timeout: { execution: 60_000 } }
    const { servers, records } = await register({ jira: own })
    expect(servers.get("jira")).toEqual(own)
    // Its oauth block names no scope, so OpenCode would request every scope Atlassian advertises: status says so.
    expect(records).toEqual([[{ type: "adopted", url: ENDPOINT, signIn: "oauth", scope: "missing" }, undefined]])
    const keyed = { type: "remote" as const, url: ENDPOINT, oauth: false as const, headers: { Authorization: `Bearer ${KEY}` } }
    const withKey = await register({ jira: keyed })
    expect(withKey.servers.get("jira")).toEqual(keyed)
    expect(withKey.records).toEqual([[{ type: "adopted", url: ENDPOINT, signIn: "own", scope: "token" }, undefined]])
    // The plugin never copies the entry's headers anywhere it reports.
    expect(JSON.stringify(withKey.records)).not.toContain(KEY)
  })

  test("classifies an adopted entry's own scope against the pin, reading nothing else of it", async () => {
    const adopted = async (oauth: unknown) => (await register({ jira: { type: "remote", url: ENDPOINT, oauth } as never })).records[0]![0]
    const scope = (source: ServerSource | undefined) => (source as Extract<ServerSource, { type: "adopted" }>).scope
    expect(scope(await adopted({ scope: OAUTH_SCOPE }))).toBe("pinned")
    // A repeated or reordered pin is still the pin.
    expect(scope(await adopted({ scope: `${OAUTH_SCOPE} ${OAUTH_SCOPE}`, callback_port: 19876 }))).toBe("pinned")
    expect(scope(await adopted({ scope: OAUTH_SCOPE.split(" ").reverse().join(" ") }))).toBe("pinned")
    expect(scope(await adopted({ scope: "" }))).toBe("missing")
    expect(scope(await adopted({}))).toBe("missing")
    expect(scope(await adopted(undefined))).toBe("missing")
    expect(scope(await adopted({ scope: `${OAUTH_SCOPE} delete:jira:agent-interface` }))).toBe("wider")
    expect(scope(await adopted({ scope: "read:jira:agent-interface offline_access" }))).toBe("narrower")
    expect(scope(await adopted(false))).toBe("token")
    expect(scopeOf(undefined)).toBe("missing")
  })

  test("reports the meta-tool URL, a v1 URL, another origin or a local command as a conflict and adds nothing", async () => {
    // Without `?tools=all` the server sends `discover` and `execute*`, whose tools this plugin's table does not describe.
    const plain = { type: "remote" as const, url: "https://mcp.atlassian.com/v2/mcp" }
    const meta = await register({ jira: plain })
    expect([...meta.servers]).toEqual([["jira", plain]])
    expect(meta.records).toEqual([[{ type: "conflict", url: "https://mcp.atlassian.com/v2/mcp", expected: ENDPOINT }, undefined]])
    // Another query than `?tools=all` is not shown: it could hold a token.
    const other = await register({ jira: { type: "remote", url: "https://mcp.atlassian.com/v2/mcp?tools=none&token=secret" } })
    expect(other.records).toEqual([[{ type: "conflict", url: "https://mcp.atlassian.com/v2/mcp", expected: ENDPOINT }, undefined]])
    const v1 = await register({ jira: { type: "remote", url: "https://mcp.atlassian.com/v1/mcp" } })
    expect(v1.records?.[0]?.[0]).toMatchObject({ type: "conflict", url: "https://mcp.atlassian.com/v1/mcp" })
    const foreign = { type: "remote" as const, url: "https://atlassian-mcp.example.com/mcp?token=secret" }
    const elsewhere = await register({ jira: foreign })
    expect([...elsewhere.servers]).toEqual([["jira", foreign]])
    expect(elsewhere.records).toEqual([[{ type: "conflict", url: "https://atlassian-mcp.example.com/…", expected: ENDPOINT }, undefined]])
    const local = await register({ jira: { type: "local", command: ["jira-mcp"] } })
    expect(local.records).toEqual([[{ type: "conflict", url: "a local command", expected: ENDPOINT }, undefined]])
  })

  test("never throws from the transform", async () => {
    const { transform, run } = transforms<McpEditor>()
    const records: [ServerSource | undefined, string | undefined][] = []
    await registerServer({ transform }, serverConfig(seam), (source, problem) => records.push([source, problem]))
    const { editor } = mcpEditor()
    expect(() => run({ ...editor, get: () => { throw new Error("broken editor") } })).not.toThrow()
    expect(records).toEqual([[undefined, "SERVER_NOT_REGISTERED: The jira MCP server could not be registered (broken editor). Next step: Restart OpenCode."]])
  })

  test("status URLs keep `?tools=all`, because it decides the tool list, and drop every other query", () => {
    expect(displayUrl("https://user:pass@mcp.atlassian.com/v2/mcp/?tools=all#x")).toBe(ENDPOINT)
    expect(displayUrl("https://mcp.atlassian.com/v2/mcp")).toBe("https://mcp.atlassian.com/v2/mcp")
    expect(displayUrl("https://user:pass@mcp.atlassian.com/v2/mcp?key=1")).toBe("https://mcp.atlassian.com/v2/mcp")
    expect(displayUrl("not a url")).toBe("an invalid URL")
  })
})

type SetupContext = Pick<Plugin.Context, "app" | "options" | "mcp" | "agent" | "skill" | "command" | "session" | "tool" | "integration" | "rpc" | "permission" | "location" | "event">

/** A context with only what setup touches. Each transform is collected so the test can replay it. */
function context(options: unknown, version = "2.2.3") {
  const mcp = transforms<McpEditor>()
  const agent = transforms<Parameters<Parameters<Plugin.Context["agent"]["transform"]>[0]>[0]>()
  const skill = transforms<Parameters<Parameters<Plugin.Context["skill"]["transform"]>[0]>[0]>()
  const command = transforms<Parameters<Parameters<Plugin.Context["command"]["transform"]>[0]>[0]>()
  const tool = transforms<Parameters<Parameters<Plugin.Context["tool"]["transform"]>[0]>[0]>()
  const rpc: string[] = []
  const handlers = new Map<string, Record<string, (input: unknown, context: unknown) => Promise<unknown>>>()
  const hooks: string[] = []
  const ctx = {
    app: { name: "opencode", version, channel: "latest" },
    options: options as Plugin.Context["options"],
    mcp: { transform: mcp.transform, list: async () => ({ data: [{ name: "jira", status: { status: "connected" } }] }) },
    skill: { transform: skill.transform, list: async () => ({ data: [] }) },
    command: { transform: command.transform },
    rpc: {
      register: async (definition: { id: string }, methods: Record<string, (input: unknown, context: unknown) => Promise<unknown>>) => {
        rpc.push(definition.id)
        handlers.set(definition.id, methods)
        return { dispose: async () => void rpc.splice(rpc.indexOf(definition.id), 1) }
      },
    },
    // A session whose agent allows everything, and one Jira read that answers "ok".
    session: { get: async () => ({ id: "ses_test", agent: "build", location: { directory: "/projects/jira-test" }, permissions: [] }) },
    agent: { transform: agent.transform, list: async () => ({ data: [] }), get: async () => ({ data: { id: "build", permissions: [{ action: "*", resource: "*", effect: "allow" }] } }) },
    tool: {
      transform: tool.transform,
      list: async () => [{ id: "jira_searchJiraIssuesUsingJql", execute: async () => ({ content: [{ type: "text", text: "ok" }] }) }],
      hook: async (name: string) => (hooks.push(`tool:${name}`), { dispose: async () => void hooks.splice(hooks.indexOf(`tool:${name}`), 1) }),
    },
    location: { directory: "/projects/jira-test" },
    permission: { hook: async (name: string) => (hooks.push(name), { dispose: async () => void hooks.splice(hooks.indexOf(name), 1) }) },
    event: { subscribe: ({ signal }: { signal: AbortSignal }) => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise((resolve) => signal.addEventListener("abort", () => resolve({ done: true, value: undefined }))) }) }) },
  } as unknown as SetupContext
  return { ctx: ctx as Plugin.Context, mcp, agent, skill, command, tool, rpc, handlers, hooks }
}

describe("setup", () => {
  test("the package default export is the plugin with its stable ID", () => {
    expect(jira.id).toBe("jira.issues")
    expect(typeof jira.setup).toBe("function")
  })

  test("registers the server, the rules, the skills, the status command, its RPC and the tools RPC", async () => {
    const { ctx, mcp, agent, skill, command, tool, rpc, hooks } = context({})
    const cleanup = await createJiraPlugin(seam).setup(ctx)
    const { editor, servers } = mcpEditor()
    mcp.run(editor)
    expect(servers.get("jira")).toEqual(serverConfig(seam))
    const agents = builtInAgents()
    agent.run(agentEditor(agents))
    expect(agents.every((item) => item.permissions[1]?.action === "jira_*")).toBe(true)
    const skills: string[] = []
    skill.run({ add: (info: { id: string }) => skills.push(info.id) } as never)
    expect(skills).toEqual([...SKILL_NAMES])
    const commands: string[] = []
    command.run({ add: (definition: { name: string }) => commands.push(definition.name) })
    expect(commands).toEqual(["jira-status"])
    // Code Mode's catalog describes the jira namespace; the plugin adds no tool of its own.
    const namespaces: { name: string; description?: string }[] = []
    const tools: unknown[] = []
    tool.run({ namespace: (namespace: { name: string; description?: string }) => void namespaces.push(namespace), add: (info: unknown) => void tools.push(info) } as never)
    expect(namespaces).toEqual([{ name: "jira", description: NAMESPACE_DESCRIPTION }])
    expect(tools).toEqual([])
    // The always-visible rules: read the skill, what asks, what is off and not granted, who a change can email,
    // untrusted text, and where the tools come from.
    for (const words of [
      "Read the jira skill before the first call",
      "Changes ask first; deletes and project or screen settings are off, and not granted",
      "Every change can email watchers and everyone mentioned",
      "untrusted text",
      "through Atlassian's MCP server",
    ]) {
      expect(NAMESPACE_DESCRIPTION).toContain(words)
    }
    expect(NAMESPACE_DESCRIPTION).not.toContain(ENDPOINT)
    expect(NAMESPACE_DESCRIPTION).not.toContain("http")
    expect(rpc).toEqual(["jira.issues", "jira.issues.tools"])
    // The tools RPC's one evaluate hook, and the account read's hook: the account and site rows come from the user's own
    // calls, never from a call the plugin makes.
    expect(hooks.sort()).toEqual(["evaluate", "tool:execute.after"])
    expect(typeof cleanup).toBe("function")
    await cleanup!()
    expect(rpc).toEqual(["jira.issues"])
    expect(hooks).toEqual([])
  })

  test.each([
    ["registers its own server", {}, { value: { text: "ok" } }],
    ["adopts the user's server at Jira's URL", { jira: { type: "remote", url: ENDPOINT, oauth: false, headers: { Authorization: `Bearer ${KEY}` } } }, { value: { text: "ok" } }],
    ["finds a user server at another URL", { jira: { type: "remote", url: "https://atlassian-mcp.example.com/mcp" } }, { code: "SERVER_CONFLICT" }],
  ] as const)("the tools RPC runs a read when the plugin %s, or refuses with its code", async (_, initial, expected) => {
    const { ctx, mcp, handlers } = context({})
    const cleanup = await createJiraPlugin(seam).setup(ctx)
    mcp.run(mcpEditor(initial as Parameters<typeof mcpEditor>[0]).editor)
    const rpcContext = { signal: new AbortController().signal, error: (_type: string, _message: string, data: { code: string }) => ({ code: data.code }) }
    const result = await handlers.get("jira.issues.tools")!.searchJiraIssuesUsingJql!({ sessionID: "ses_test", input: { jql: "project = PROJ" } }, rpcContext)
    expect("code" in (result as object) ? result : { value: result }).toEqual(expected)
    expect(JSON.stringify(result)).not.toContain(KEY)
    await cleanup!()
  })

  test("a server that could not be registered is not called a conflict, and a conflicting server gets no namespace text", async () => {
    const rpcContext = { signal: new AbortController().signal, error: (_type: string, _message: string, data: { code: string }) => ({ code: data.code }) }
    // The mcp transform throws: the tools RPC reports the server's state, not SERVER_CONFLICT.
    const broken = context({})
    const stopBroken = await createJiraPlugin(seam).setup(broken.ctx)
    broken.mcp.run({ get: () => { throw new Error("broken editor") } } as never)
    const result = await broken.handlers.get("jira.issues.tools")!.searchJiraIssuesUsingJql!({ sessionID: "ses_test", input: { jql: "project = PROJ" } }, rpcContext)
    expect(result).not.toEqual({ code: "SERVER_CONFLICT" })
    await stopBroken!()
    // A server at another URL is not Jira's: Code Mode keeps its own description of it.
    const foreign = context({})
    const stopForeign = await createJiraPlugin(seam).setup(foreign.ctx)
    foreign.mcp.run(mcpEditor({ jira: { type: "remote", url: "https://atlassian-mcp.example.com/mcp" } }).editor)
    const namespaces: unknown[] = []
    foreign.tool.run({ namespace: (namespace: unknown) => void namespaces.push(namespace), add: () => {} } as never)
    expect(namespaces).toEqual([])
    await stopForeign!()
  })

  test("refuses invalid options and untested hosts before registering anything", async () => {
    const invalid = context({ apiKey: KEY })
    await expect(createJiraPlugin(seam).setup(invalid.ctx)).rejects.toThrow("OPTIONS_INVALID")
    const untested = context({}, "0.0.0-dev-1")
    await expect(createJiraPlugin(seam).setup(untested.ctx)).rejects.toThrow("HOST_UNTESTED")
    for (const item of [invalid, untested]) expect([item.mcp, item.agent, item.skill, item.command, item.tool].map((t) => t.callbacks.length)).toEqual([0, 0, 0, 0, 0])
    for (const item of [invalid, untested]) expect([item.rpc, item.hooks]).toEqual([[], []])
  })

  test("a host outside the range runs with the override, and an untested release inside the range runs without it", async () => {
    for (const [options, version] of [[{ allowUntestedHost: true }, "2.3.0"], [{}, "2.2.6"]] as const) {
      const { ctx, mcp } = context(options, version)
      const cleanup = await createJiraPlugin(seam).setup(ctx)
      expect(mcp.callbacks).toHaveLength(1)
      await cleanup!()
    }
  })
})
