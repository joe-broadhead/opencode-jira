import { describe, expect, test } from "bun:test"
import { checkHost } from "../../src/host-version.js"
import { defaultRules } from "../../src/permissions.js"
import { buildStatus, formatStatus, readStatus, registerStatusCommand, registerStatusRpc, shortReason, StatusRpc, type Status, type StatusContext, type StatusFacts } from "../../src/status.js"
import { VERSION } from "../../src/version.js"
import { DENY_TOOLS, NOT_GRANTED_TOOLS, WRITE_TOOLS } from "../../src/jira-tools.js"
import { allow } from "./fake.js"

const SIGN_IN = "Run /connect and choose Jira, then press o or Enter to open the link (in a terminal, opencode mcp auth jira opens it automatically)."
const NOTHING_TO_DO = "Nothing to do."
const NOT_READ_YET = "not read yet: it appears after the first Jira call since OpenCode started"
/** The default rules as /jira-status shows them: one rule a line, a JSON array body. */
const AGENT_RULES = defaultRules().map((rule, index, rules) => `  ${JSON.stringify(rule)}${index < rules.length - 1 ? "," : ""}`).join("\n")

const host = checkHost("2.2.3", false)
const URL = "https://mcp.atlassian.com/v2/mcp?tools=all"
const base: StatusFacts = {
  server: { status: "connected" },
  source: { type: "plugin", url: URL, signIn: "oauth" },
  host,
  account: { name: "Sam Okafor", sites: ["Acme", "Sandbox"] },
  tools: ["searchJiraIssuesUsingJql"],
}
const guarded = { id: "build", permissions: [allow("*"), ...defaultRules()] }
const RULES = "no agent runs new Jira tools unasked"
const POSTURE = `reads run without asking; the ${WRITE_TOOLS.length} changes ask first; ${DENY_TOOLS.length} tools are off, and the deletes and the project and screen settings are not granted either`
const ACCESS = `${POSTURE}; ${RULES}`
const NOT_GRANTED = `not granted by scope: ${NOT_GRANTED_TOOLS.slice(0, -1).join(", ")} and ${NOT_GRANTED_TOOLS.at(-1)}`

describe("buildStatus", () => {
  test("connected, with the account, the sites and nothing left to do", () => {
    const status = buildStatus({ ...base, agents: [guarded] })
    expect(status).toEqual({
      version: VERSION,
      state: "connected",
      source: { type: "plugin", url: URL, signIn: "oauth" },
      account: "Sam Okafor",
      sites: ["Acme", "Sandbox"],
      tools: 1,
      deniedTools: [],
      notGranted: [...NOT_GRANTED_TOOLS],
      listing: false,
      unknownCount: 0,
      unknownTools: [],
      unguardedAgents: [],
      host: { version: "2.2.3", range: ">=2.2.3 <2.3.0", tested: true },
      problems: [],
      nextStep: "Nothing to do.",
    })
    expect(formatStatus(status)).toBe(
      [
        "Jira status",
        `- Connection: connected (${URL}, registered by this plugin)`,
        "- Account: Sam Okafor",
        `- Access: ${ACCESS}`,
        "- Sites: 2 sites: Acme, Sandbox",
        `- Tools: 1 available, 0 unknown; ${NOT_GRANTED}`,
        "- Agents without default rules: none",
        "- OpenCode: 2.2.3 (tested; supported range >=2.2.3 <2.3.0)",
        "- Next step: Nothing to do.",
      ].join("\n"),
    )
  })

  test("before the user's own reads, the Account and Sites rows say so; nothing shows an email or a cloud id", () => {
    const status = buildStatus({ ...base, account: undefined })
    expect(status).not.toHaveProperty("account")
    expect(status.sites).toEqual([])
    const text = formatStatus(status)
    expect(text).toContain(`- Account: ${NOT_READ_YET}\n`)
    expect(text).toContain(`- Sites: ${NOT_READ_YET}\n`)
    expect(text).not.toContain("@")
    expect(buildStatus({ ...base, account: { name: "" } })).not.toHaveProperty("account")
  })

  test("one site reads in the singular, and the row counts the rest", () => {
    expect(formatStatus(buildStatus({ ...base, account: { sites: ["Acme"] } }))).toContain("- Sites: 1 site: Acme\n")
    const many = Array.from({ length: 9 }, (_, index) => `Site ${index + 1}`)
    expect(formatStatus(buildStatus({ ...base, account: { sites: many } }))).toContain("- Sites: 9 sites: Site 1, Site 2, Site 3, Site 4, Site 5, Site 6 and 3 more\n")
  })

  test.each([
    [{ status: "needs_auth", error: "Authorization required" }, "sign_in_required", "sign-in required", SIGN_IN],
    [{ status: "failed", error: "fetch failed" }, "failed", "failed", "Check your network, then run /jira-status again."],
    [{ status: "disabled" }, "disabled", "disabled", `The jira MCP server is disabled. Enable it in /mcps, or remove "disabled": true from mcp.servers.jira in opencode.json.`],
    [{ status: "pending" }, "connecting", "connecting", "Jira is still connecting. Run /jira-status again in a few seconds."],
    [undefined, "not_configured", "not configured", "OpenCode has no jira MCP server. Check that no organisation policy (mcp.use) or other plugin removes it, then restart OpenCode."],
  ] as const)("%j is %s with the exact label and next step", (server, state, label, nextStep) => {
    const status = buildStatus({ ...base, ...(server ? { server } : { server: undefined }) })
    expect(status.state).toBe(state)
    expect(status.nextStep).toBe(nextStep)
    expect(formatStatus(status)).toContain(`- Connection: ${label}`)
    expect(formatStatus(status)).toContain(`- Next step: ${nextStep}`)
  })

  test("shows a failure's reason on one short line, without URL queries, and never the text of a needed sign-in", () => {
    const failed = buildStatus({ ...base, server: { status: "failed", error: "SSE error:\n  fetch https://mcp.atlassian.com/v2/mcp?token=secret-123 failed.\n" } })
    expect(failed.error).toBe("SSE error: fetch https://mcp.atlassian.com/v2/mcp failed")
    expect(formatStatus(failed)).toContain(`- Connection: failed (SSE error: fetch https://mcp.atlassian.com/v2/mcp failed; ${URL}, registered by this plugin)`)
    expect(shortReason("word ".repeat(100))).toHaveLength(160)
    expect(shortReason(" \n. ")).toBeUndefined()
    const signIn = buildStatus({ ...base, server: { status: "needs_auth", error: "Visit https://auth.atlassian.com/authorize?code=abc to sign in" } })
    expect(signIn.error).toBeUndefined()
    expect(formatStatus(signIn)).not.toContain("authorize")
  })

  test("adopted and conflicting servers", () => {
    expect(formatStatus(buildStatus({ ...base, source: { type: "adopted", url: URL, signIn: "oauth" } }))).toContain(`- Connection: connected (${URL}, your own mcp.servers.jira, used unchanged)`)
    // Your own entry has a scope of its own, so the plugin does not claim its scope withheld a tool.
    expect(buildStatus({ ...base, source: { type: "adopted", url: URL, signIn: "oauth" } }).notGranted).toEqual([])
    const conflict = buildStatus({ ...base, source: { type: "conflict", url: "https://atlassian-mcp.example.com/mcp", expected: URL } })
    expect(conflict.state).toBe("conflict")
    expect(conflict.nextStep).toBe(
      `Your OpenCode config defines mcp.servers.jira with https://atlassian-mcp.example.com/mcp, but the plugin uses ${URL}. Point it at ${URL} or remove it, then restart OpenCode.`,
    )
    expect(formatStatus(conflict)).toContain("- Connection: conflict (your mcp.servers.jira points at https://atlassian-mcp.example.com/mcp)")
  })

  test("the user's own entry without OAuth is named as such, and its failure names the API token in its headers", () => {
    const own = { type: "adopted", url: URL, signIn: "own" } as const
    expect(formatStatus(buildStatus({ ...base, source: own }))).toContain(`- Connection: connected (${URL}, your own mcp.servers.jira without OAuth, used unchanged)`)
    expect(buildStatus({ ...base, source: own, server: { status: "failed", error: "HTTP 401" } }).nextStep).toBe(
      "Check the API token in the headers of your mcp.servers.jira (Atlassian: id.atlassian.com, Security, API tokens), then restart OpenCode.",
    )
    expect(buildStatus({ ...base, source: own }).notGranted).toEqual([])
  })

  test("connected with no tools points at the organisation's Atlassian MCP permissions", () => {
    expect(buildStatus({ ...base, tools: [], agents: [{ id: "reviewer", permissions: [allow("*")] }] }).nextStep).toBe(
      "Ask an organisation admin to allow Read and Search for Atlassian MCP in Atlassian Administration, Connectors, Atlassian MCP server, Permissions, then run /jira-status again.",
    )
  })

  test("counts the available tools, names the unknown ones, and counts denied ones apart; missing known tools are normal", () => {
    const status = buildStatus({ ...base, tools: ["searchJiraIssuesUsingJql", "createJiraIssue", "editJiraEntityProperty", "shiny_new_tool", "new_tool_2"] })
    expect(status.tools).toBe(4)
    expect(status.deniedTools).toEqual(["editJiraEntityProperty"])
    expect(status.unknownCount).toBe(2)
    expect(status.unknownTools).toEqual(["shiny_new_tool", "new_tool_2"])
    expect(formatStatus(status)).toContain(`- Tools: 4 available, 2 unknown: shiny_new_tool, new_tool_2 (unknown tools ask before running); off by default: editJiraEntityProperty; ${NOT_GRANTED}\n`)
    expect(status.nextStep).toBe(NOTHING_TO_DO)
    const denied = buildStatus({ ...base, tools: ["searchJiraIssuesUsingJql", "deleteJiraIssue", "deleteJiraComment"] })
    expect(formatStatus(denied)).toContain("- Tools: 1 available, 0 unknown; off by default: deleteJiraIssue and deleteJiraComment; not granted by scope: ")
  })

  test("a server that just connected and lists no tools yet is still listing them, with no advice to ask an admin", () => {
    const listing = buildStatus({ ...base, tools: [], settling: true })
    expect(listing).toMatchObject({ state: "connected", tools: 0, listing: true, nextStep: "Jira is still listing its tools. Run /jira-status again in a few seconds." })
    const text = formatStatus(listing)
    expect(text).toContain(`- Connection: connected (${URL}, registered by this plugin; still listing its tools)`)
    expect(text).toContain("- Tools: none listed yet (Jira is still listing them)")
    expect(text).not.toContain("organisation admin")
    // Settled, with no tools: the organisation's permissions.
    expect(buildStatus({ ...base, tools: [], settling: false }).nextStep).toStartWith("Ask an organisation admin")
    // Not connected: the connection's own step, never "listing".
    expect(buildStatus({ ...base, tools: [], settling: true, server: { status: "pending" } })).toMatchObject({ listing: false, state: "connecting" })
  })

  test("the Access row says whether the default rules are in place, from what status can see", () => {
    expect(formatStatus(buildStatus(base))).toContain(`- Access: ${ACCESS}\n`)
    // The posture is the tool lists': 14 changes ask, 7 tools are off.
    expect(ACCESS).toContain("the 14 changes ask first; 7 tools are off, and the deletes and the project and screen settings are not granted either")
    const missing = buildStatus({ ...base, agents: [{ id: "reviewer", permissions: [allow("*")] }] })
    expect(formatStatus(missing)).toContain(`- Access: ${POSTURE}; default rules missing in the agents listed below\n`)
    const problem = "RULES_NOT_ADDED: Jira's default permission rules could not be added (boom), so Jira tools may run without asking. Next step: Restart OpenCode."
    expect(formatStatus(buildStatus({ ...base, problems: [problem] }))).toContain(`- Access: ${POSTURE}; default rules not added (see the OpenCode row)\n`)
  })

  test("a failure's reason never carries a token or key the host's text echoed", () => {
    const failed = buildStatus({ ...base, server: { status: "failed", error: "HTTP 401 for Authorization: Bearer sk-fake-abcdef123456 and api_key=fake-key-000111" } })
    expect(failed.error).toBeDefined()
    expect(failed.error).not.toMatch(/sk-fake|abcdef123456|fake-key-000111/)
  })

  test("names at most 20 unknown tools, and only plain names, but counts them all", () => {
    const odd = ["Bad Name", "x".repeat(70), "evil\u001b[31m", "-dash"]
    const many = Array.from({ length: 25 }, (_, index) => `new_tool_${index}`)
    const status = buildStatus({ ...base, tools: ["searchJiraIssuesUsingJql", ...odd, ...many] })
    expect(status.unknownCount).toBe(29)
    expect(status.unknownTools).toEqual(many.slice(0, 20))
    expect(formatStatus(status)).toContain(`- Tools: 30 available, 29 unknown: ${many.slice(0, 20).join(", ")} and 9 more (unknown tools ask before running)`)
    expect(formatStatus(buildStatus({ ...base, tools: odd }))).toContain("- Tools: 4 available, 4 unknown (unknown tools ask before running)")
  })

  test("names agents without the default rules, with the block to paste, and points the next step at it", () => {
    const status = buildStatus({ ...base, agents: [guarded, { id: "reviewer", permissions: [allow("*")] }] })
    expect(status.unguardedAgents).toEqual(["reviewer"])
    expect(status.nextStep).toBe(
      "Put the default rules shown by /jira-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Jira tools.",
    )
    expect(JSON.parse(`[${AGENT_RULES}]`)).toEqual(defaultRules())
    expect(formatStatus(status)).toContain(`- Agents without default rules: reviewer\n${AGENT_RULES}\n- OpenCode:`)
  })

  test("an agent whose own rules already ask or deny for every Jira tool is not listed", () => {
    const agents = [
      { id: "asks-everything", permissions: [allow("*"), { action: "*", resource: "*", effect: "ask" as const }] },
      { id: "denies-jira", permissions: [allow("*"), { action: "jira_*", resource: "*", effect: "deny" as const }] },
      { id: "reviewer", permissions: [allow("*")] },
    ]
    expect(buildStatus({ ...base, agents }).unguardedAgents).toEqual(["reviewer"])
  })

  test("the sign-in step comes before the agent fix, which still shows, and there is one next step", () => {
    const status = buildStatus({ ...base, server: { status: "needs_auth", error: "x" }, agents: [{ id: "reviewer", permissions: [allow("*")] }] })
    expect(status.nextStep).toBe(SIGN_IN)
    const text = formatStatus(status)
    expect(text).toContain(`- Connection: sign-in required (${URL}, registered by this plugin)`)
    expect(text).toContain("- Agents without default rules: reviewer\n")
    expect(text.match(/Next step/g)).toHaveLength(1)
  })

  test("the rows come in the standard order", () => {
    const rows = formatStatus(buildStatus(base)).split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2, line.indexOf(":")))
    expect(rows).toEqual(["Connection", "Account", "Access", "Sites", "Tools", "Agents without default rules", "OpenCode", "Next step"])
  })

  test("a skill of the same id at another path shadows the plugin's: status names it, after any other next step", () => {
    const own = [{ id: "jira", path: "/pkg/skills/jira/SKILL.md" }, { id: "jira-write", path: "/pkg/skills/jira-write/SKILL.md" }]
    const listed = [{ id: "jira", path: "/projects/acme/.opencode/skills/jira/SKILL.md" }, own[1]!, { id: "other", path: "/x" }]
    const status = buildStatus({ ...base, skills: { own, listed } })
    expect(status.shadowedSkills).toEqual([{ id: "jira", path: "/projects/acme/.opencode/skills/jira/SKILL.md" }])
    expect(status.nextStep).toBe('Rename or move the "jira" skill at /projects/acme/.opencode/skills/jira/SKILL.md, which OpenCode loads instead of the plugin\'s skill of the same name.')
    expect(buildStatus({ ...base, skills: { own, listed: own } })).not.toHaveProperty("shadowedSkills")
    expect(buildStatus({ ...base, skills: { own, listed }, agents: [{ id: "reviewer", permissions: [allow("*")] }] }).nextStep).toStartWith("Put the default rules")
  })

  test("an untested host and setup problems show on the OpenCode row; a problem's own next step comes first", () => {
    const outside = checkHost("2.3.0", true)
    const problem = 'SKILLS_INVALID: The "jira" skill was not loaded: skills/jira/SKILL.md is missing. Next step: Reinstall the plugin.'
    const status = buildStatus({ ...base, host: outside, problems: [problem] })
    expect(status.nextStep).toBe("Reinstall the plugin.")
    expect(formatStatus(status)).toContain(
      `- OpenCode: 2.3.0 (untested; supported range >=2.2.3 <2.3.0). It is outside the supported range; the plugin runs because allowUntestedHost is true. If Jira misbehaves, use OpenCode 2.2.3, 2.2.4 or 2.2.5. ${problem}`,
    )
    expect(buildStatus({ ...base, host: outside }).nextStep).toBe(NOTHING_TO_DO)
    const inside = buildStatus({ ...base, host: checkHost("2.2.6", false) })
    expect(inside).toMatchObject({ state: "connected", host: { version: "2.2.6", tested: false }, nextStep: NOTHING_TO_DO })
    expect(buildStatus({ ...base, host: checkHost("2.2.6", false), server: { status: "needs_auth" } }).nextStep).toBe(SIGN_IN)
    expect(formatStatus(inside)).toContain("- OpenCode: 2.2.6 (untested; supported range >=2.2.3 <2.3.0)\n")
    expect(formatStatus(buildStatus({ ...base, host: checkHost("2.2.5", false) }))).toContain("- OpenCode: 2.2.5 (tested; supported range >=2.2.3 <2.3.0)\n")
  })
})

function statusContext(server: string, skills: Promise<unknown> = Promise.resolve({ data: [] }), connection: () => Promise<unknown> = async () => ({ type: "credential", id: "c1", label: "Sam Okafor", method: "oauth" })) {
  const ctx = {
    mcp: { list: async () => ({ data: [{ name: "github", status: { status: "connected" } }, { name: "jira", status: { status: server }, integrationID: "mcp_fake" }] }) },
    integration: { connection: { active: async (id: string) => (id === "mcp_fake" ? connection() : undefined) } },
    agent: { list: async () => ({ data: [guarded, { id: "reviewer", permissions: [allow("*")] }] }) },
    tool: {
      list: async () => [
        { id: "jira_searchJiraIssuesUsingJql", name: "searchJiraIssuesUsingJql", options: { namespace: "jira" } },
        { id: "jira_shiny_new_tool", name: "shiny_new_tool", options: { namespace: "jira" } },
        { id: "other_search", name: "search", options: { namespace: "other" } },
        { id: "read", name: "read" },
      ],
    },
    skill: { list: () => skills },
  }
  return ctx as unknown as StatusContext
}

describe("readStatus", () => {
  test("reads connection, tools and agents through public APIs, and the captured account and sites", async () => {
    const account = { current: () => ({ name: "Sam Okafor", sites: ["Acme", "Sandbox"] }), forget: () => {} }
    const status = await readStatus(statusContext("connected"), { source: { type: "plugin", url: URL, signIn: "oauth" }, host, problems: [], listing: { changedAt: () => 0 }, account })
    expect(status).toMatchObject({ state: "connected", account: "Sam Okafor", sites: ["Acme", "Sandbox"], tools: 2, unknownTools: ["shiny_new_tool"], unguardedAgents: ["reviewer"], listing: false })
  })

  test("the sign-in's label is not the account: without an account read, the row says not read yet", async () => {
    const status = await readStatus(statusContext("connected"), { host })
    expect(status).toMatchObject({ state: "connected", tools: 2, sites: [] })
    expect(status).not.toHaveProperty("account")
    const failed = await readStatus(statusContext("connected", undefined, () => Promise.reject(new Error("offline"))), { host })
    expect(failed).toMatchObject({ state: "connected", tools: 2 })
  })

  test("a server that needs a new sign-in forgets the account it had", async () => {
    let forgotten = false
    const account = { current: () => ({ name: "Sam Okafor" }), forget: () => void (forgotten = true) }
    await readStatus(statusContext("needs_auth"), { host, account })
    expect(forgotten).toBe(true)
  })

  test("no tools moments after a status change is still listing; later it is not", async () => {
    const empty = statusContext("connected")
    ;(empty as unknown as { tool: { list: () => Promise<unknown[]> } }).tool.list = async () => []
    expect(await readStatus(empty, { host, listing: { changedAt: () => Date.now() } })).toMatchObject({ listing: true })
    expect(await readStatus(empty, { host, listing: { changedAt: () => Date.now() - 60_000 } })).toMatchObject({ listing: false })
  })

  test("names shadowed skills from the host's list, and a failed skill list hides nothing else", async () => {
    const own = [{ id: "jira", path: "/pkg/skills/jira/SKILL.md" }]
    const listed = Promise.resolve({ data: [{ id: "jira", path: "/home-skills/jira/SKILL.md" }] })
    expect((await readStatus(statusContext("connected", listed), { host, skills: own })).shadowedSkills).toEqual([{ id: "jira", path: "/home-skills/jira/SKILL.md" }])
    const failed = await readStatus(statusContext("connected", Promise.reject(new Error("offline"))), { host, skills: own })
    expect(failed).toMatchObject({ state: "connected", tools: 2 })
    expect(failed).not.toHaveProperty("shadowedSkills")
  })
})

describe("/jira-status", () => {
  async function run(read: () => Promise<Status>) {
    const posted: unknown[] = []
    let execute: ((input: { sessionID: string }) => Promise<void>) | undefined
    await registerStatusCommand(
      {
        command: { transform: async (callback) => (callback({ add: (definition) => void (execute = definition.execute as never) }), { dispose: async () => {} }) },
        session: { synthetic: async (input) => (posted.push(input), {}) as never },
      },
      read,
    )
    await execute!({ sessionID: "ses_1" })
    return posted
  }

  test("posts the status text into the session without starting a turn", async () => {
    const posted = await run(async () => buildStatus(base))
    expect(posted).toEqual([{ sessionID: "ses_1", text: formatStatus(buildStatus(base)), description: "Jira status", resume: false }])
  })

  test("posts a coded error with a next step, cut to one short line without URL queries, when status cannot be read", async () => {
    const posted = (await run(() => Promise.reject(new Error("failed:\n https://x.example/a?token=t")))) as { text: string }[]
    expect(posted[0]!.text).toBe("STATUS_UNAVAILABLE: Could not read Jira's status (failed: https://x.example/a). Next step: Restart OpenCode, then run /jira-status again.")
  })
})

describe("status RPC", () => {
  async function register(read: () => Promise<Status>) {
    const registered: { id: string; methods: string[]; status: () => Promise<unknown> }[] = []
    const error = (type: string, message: string, data: unknown) => ({ type, message, data })
    await registerStatusRpc(
      {
        register: async (definition, handlers) => {
          registered.push({ id: definition.id, methods: Object.keys(definition.methods), status: () => handlers.status({} as never, { error } as never) })
          return { dispose: async () => {}, events: { emit: async () => {} } } as never
        },
      },
      read,
    )
    return registered
  }

  test("serves the same status as /jira-status through one read-only method", async () => {
    const registered = await register(async () => buildStatus(base))
    expect(registered.map(({ id, methods }) => ({ id, methods }))).toEqual([{ id: "jira.issues", methods: ["status"] }])
    expect(await registered[0]!.status()).toEqual(buildStatus(base))
    expect(StatusRpc.events).toEqual({})
  })

  test("answers a status it cannot read with its declared error, unavailable, and a next step", async () => {
    const registered = await register(() => Promise.reject(new Error("agent list failed")))
    expect(await registered[0]!.status()).toEqual({
      type: "unavailable",
      message: "STATUS_UNAVAILABLE: Could not read Jira's status (agent list failed).",
      data: { nextStep: "Restart OpenCode, then run /jira-status again." },
    })
    expect(Object.keys(StatusRpc.methods.status.errors)).toEqual(["unavailable"])
  })

  test("has the fields every plugin of this family shares, with their names", () => {
    const status = buildStatus(base)
    expect({ version: status.version, host: status.host, state: status.state, unguardedAgents: status.unguardedAgents, nextStep: status.nextStep }).toEqual({
      version: VERSION,
      host: { version: "2.2.3", range: ">=2.2.3 <2.3.0", tested: true },
      state: "connected",
      unguardedAgents: [],
      nextStep: NOTHING_TO_DO,
    })
    expect(StatusRpc.methods.status.output.required).toEqual(expect.arrayContaining(["version", "host", "state", "unguardedAgents", "nextStep"]))
  })

  test("the output schema names every status field and requires the ones always present", () => {
    const { properties, required } = StatusRpc.methods.status.output
    const statuses: Status[] = [
      buildStatus({
        ...base,
        tools: ["shiny_new_tool"],
        agents: [{ id: "reviewer", permissions: [allow("*")] }],
        problems: ["p"],
        account: { name: "Sam Okafor", sites: ["Acme"] },
        skills: { own: [{ id: "jira", path: "/a" }], listed: [{ id: "jira", path: "/b" }] },
      }),
      buildStatus({ ...base, account: undefined, server: { status: "failed", error: "fetch failed" }, source: { type: "conflict", url: "https://x.example/mcp", expected: URL }, host: checkHost("2.3.0", true) }),
    ]
    for (const status of statuses) {
      expect(Object.keys(status).filter((key) => !(key in properties))).toEqual([])
      expect(required.filter((key) => !(key in status))).toEqual([])
      expect(Object.keys(status.host).filter((key) => !(key in properties.host.properties))).toEqual([])
    }
  })
})
