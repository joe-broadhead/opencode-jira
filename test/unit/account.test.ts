// The account capture: the display name and the site names, kept in memory and forgotten on sign-out.
import { afterEach, describe, expect, test } from "bun:test"
import { captureAccount, nameOf, sitesOf, watchAccount } from "../../src/account.js"

type Event = { type: string; data: { server?: string } }

/** An event stream the test drives, ended by the subscriber's signal. */
function events() {
  const listeners = new Set<(event: Event) => void>()
  const subscribe = ({ signal }: { signal: AbortSignal }) => {
    const queue: Event[] = []
    let wake: (() => void) | undefined
    const listener = (event: Event) => (queue.push(event), wake?.())
    listeners.add(listener)
    signal.addEventListener("abort", () => (listeners.delete(listener), wake?.()))
    return {
      async *[Symbol.asyncIterator]() {
        while (!signal.aborted) {
          if (queue.length) yield queue.shift()!
          else await new Promise<void>((resolve) => (wake = resolve))
        }
      },
    }
  }
  return { subscribe, emit: (type: string, data: Event["data"] = {}) => listeners.forEach((listener) => listener({ type, data })) }
}

// Invented values, with everything the plugin must not read beside them.
const USER = { account_id: "5b10a2844c20165700ede21g", name: "Sam Okafor\u0007", email: "sam.okafor@example.com", picture: "https://avatar.example/u/1" }
const SITES = [
  { id: "cloud-1", url: "https://acme.atlassian.net", name: "Acme", scopes: ["read:jira-work"], avatarUrl: "https://avatar.example/a" },
  { id: "cloud-2", url: "https://sandbox.atlassian.net", name: "Sandbox" },
]

const stops: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop()
})
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

async function watch() {
  const stream = events()
  let after: ((event: unknown) => Promise<void> | void) | undefined
  const state = { server: "connected" }
  const account = await watchAccount({
    tool: { hook: async (_name: string, callback: (event: unknown) => void) => ((after = callback), { dispose: async () => void (after = undefined) }) },
    mcp: { list: async () => ({ data: [{ name: "jira", status: { status: state.server } }] }) },
    event: { subscribe: stream.subscribe },
  } as never)
  stops.push(account.stop)
  return { account, state, stream, after: async (event: unknown) => await after?.(event) }
}

describe("nameOf", () => {
  test("reads the display name alone: no account id, email or avatar", () => {
    expect(nameOf({ output: USER })).toBe("Sam Okafor")
    expect(nameOf({ content: [{ type: "text", text: JSON.stringify(USER) }] })).toBe("Sam Okafor")
    // The userinfo shape one level down, and the other field names Atlassian uses.
    expect(nameOf({ output: { user: { displayName: "Alex Rivera" } } })).toBe("Alex Rivera")
    expect(nameOf({ output: { me: { display_name: "Globex Admin" } } })).toBe("Globex Admin")
    expect(JSON.stringify(nameOf({ output: USER }))).not.toMatch(/5b10a284|sam\.okafor|avatar/)
  })

  test("cuts a long name, and ignores results without a usable one", () => {
    expect(nameOf({ output: { name: "x".repeat(200) } })!).toHaveLength(80)
    for (const result of [{}, { output: "not json" }, { output: [1] }, { content: [{ type: "image" }] }, { output: { name: 3 } }, { output: { name: "  " } }]) expect(nameOf(result)).toBeUndefined()
  })
})

describe("sitesOf", () => {
  test("reads the site names in order: no cloud id, URL, scope or avatar", () => {
    expect(sitesOf({ output: SITES })).toEqual(["Acme", "Sandbox"])
    expect(sitesOf({ output: { sites: SITES } })).toEqual(["Acme", "Sandbox"])
    expect(sitesOf({ output: { resources: SITES } })).toEqual(["Acme", "Sandbox"])
    expect(sitesOf({ content: [{ type: "text", text: JSON.stringify(SITES) }] })).toEqual(["Acme", "Sandbox"])
    expect(JSON.stringify(sitesOf({ output: SITES }))).not.toMatch(/cloud-|atlassian\.net|read:jira-work|avatar/)
  })

  test("deduplicates, keeps ten, cuts a long name, and reports an empty list as empty", () => {
    expect(sitesOf({ output: [SITES[0]!, SITES[0]!] })).toEqual(["Acme"])
    expect(sitesOf({ output: Array.from({ length: 14 }, (_, index) => ({ id: `c${index}`, name: `Site ${index}` })) })).toHaveLength(10)
    expect(sitesOf({ output: [{ id: "c1", name: "y".repeat(200) }] })?.[0]).toHaveLength(40)
    expect(sitesOf({ output: [] })).toEqual([])
  })

  test("ignores a result that is not a list of sites", () => {
    for (const result of [{}, { output: "not json" }, { output: { name: "Acme" } }, { output: [{ name: "Acme" }] }, { output: [{ id: "c1" }] }]) expect(sitesOf(result)).toBeUndefined()
  })
})

describe("watchAccount", () => {
  test("captures a completed model call of either account read, and only those", async () => {
    const { account, after } = await watch()
    await after({ tool: "jira_searchJiraIssuesUsingJql", status: "completed", result: { output: USER } })
    expect(account.current()).toBeUndefined()
    await after({ tool: "jira_atlassianUserInfo", status: "error", error: new Error("x") })
    expect(account.current()).toBeUndefined()
    await after({ tool: "jira_atlassianUserInfo", status: "completed", result: { output: USER } })
    expect(account.current()).toEqual({ name: "Sam Okafor" })
    await after({ tool: "jira_getAccessibleAtlassianResources", status: "completed", result: { output: SITES } })
    expect(account.current()).toEqual({ name: "Sam Okafor", sites: ["Acme", "Sandbox"] })
    // A later result without the fields keeps what was read.
    await after({ tool: "jira_atlassianUserInfo", status: "completed", result: { output: "{}" } })
    expect(account.current()?.name).toBe("Sam Okafor")
  })

  test("a script's read through the tools RPC reaches every running instance", async () => {
    const first = await watch()
    const second = await watch()
    captureAccount("atlassianUserInfo", { output: USER })
    captureAccount("getAccessibleAtlassianResources", { output: SITES })
    expect([first.account.current(), second.account.current()]).toEqual([{ name: "Sam Okafor", sites: ["Acme", "Sandbox"] }, { name: "Sam Okafor", sites: ["Acme", "Sandbox"] }])
  })

  test("forgets the account when the server needs a new sign-in or the account is switched", async () => {
    const { account, after, state, stream } = await watch()
    await after({ tool: "jira_atlassianUserInfo", status: "completed", result: { output: USER } })
    await tick()
    stream.emit("mcp.status.changed", { server: "other" })
    await tick()
    expect(account.current()).toBeDefined()
    state.server = "needs_auth"
    stream.emit("mcp.status.changed", { server: "jira" })
    await tick()
    expect(account.current()).toBeUndefined()
    state.server = "connected"
    await after({ tool: "jira_atlassianUserInfo", status: "completed", result: { output: USER } })
    expect(account.current()).toBeDefined()
    stream.emit("credential.switched")
    await tick()
    expect(account.current()).toBeUndefined()
  })

  test("while any instance signs in with its own API-token entry, a script's read updates no status", async () => {
    const shared = await watch()
    const stream = events()
    const own = await watchAccount(
      { tool: { hook: async () => ({ dispose: async () => {} }) }, mcp: { list: async () => ({ data: [] }) }, event: { subscribe: stream.subscribe } } as never,
      () => true,
    )
    stops.push(own.stop)
    captureAccount("atlassianUserInfo", { output: USER })
    expect([shared.account.current(), own.current()]).toEqual([undefined, undefined])
    // The model path belongs to its own instance, so it still records the account there.
    await shared.after({ tool: "jira_atlassianUserInfo", status: "completed", result: { output: USER } })
    expect(shared.account.current()?.name).toBe("Sam Okafor")
  })

  test("an instance whose jira server is at another URL records nothing, from the model or a script", async () => {
    const stream = events()
    let after: ((event: unknown) => Promise<void> | void) | undefined
    const foreign = await watchAccount(
      {
        tool: { hook: async (_name: string, callback: (event: unknown) => void) => ((after = callback), { dispose: async () => {} }) },
        mcp: { list: async () => ({ data: [{ name: "jira", status: { status: "connected" } }] }) },
        event: { subscribe: stream.subscribe },
      } as never,
      () => false,
      () => false,
    )
    stops.push(foreign.stop)
    await after?.({ tool: "jira_atlassianUserInfo", status: "completed", result: { output: USER } })
    captureAccount("atlassianUserInfo", { output: USER })
    expect(foreign.current()).toBeUndefined()
  })

  test("stops capturing once stopped", async () => {
    const { account } = await watch()
    await stops.pop()!()
    captureAccount("atlassianUserInfo", { output: USER })
    expect(account.current()).toBeUndefined()
  })
})
