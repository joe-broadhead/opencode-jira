import { Plugin, type Mcp } from "@opencode/plugin"
import { reasonOf } from "./redact.js"
import { errorText, NAMESPACE_DESCRIPTION, OAUTH_SCOPE, PLUGIN_ID, SERVER_NAME } from "./constants.js"
import { checkHost } from "./host-version.js"
import { registerToolsRpc } from "./host/tools-rpc.js"
import { watchIntegration } from "./integration.js"
import { watchListing } from "./listing.js"
import { watchAccount } from "./account.js"
import { parseOptions } from "./options.js"
import { defaultRules, registerDefaultRules } from "./permissions.js"
import { loadSkills, registerSkills } from "./skills.js"
import { readStatus, registerStatusCommand, registerStatusRpc, type ServerSource } from "./status.js"

/** Internal seam: tests point the server at a loopback fake without OAuth, and at their own skills. */
interface JiraSeam {
  readonly endpoint: string
  readonly oauth?: false
  readonly skillsDir?: string
}

type RemoteConfig = Extract<Mcp.ServerConfig, { type: "remote" }>

/**
 * The scope is pinned because Atlassian's 401 names none and its metadata lists about 40: without it OpenCode would
 * request all of them, and the grant itself would cover delete, manage and Confluence. Nothing else is set: no
 * `client_id` and no `redirect_uri`, which would turn off the client ID metadata document and force dynamic
 * registration. Only the tests' seam sets `oauth: false`.
 */
export const serverConfig = (seam: JiraSeam): RemoteConfig =>
  seam.oauth === false
    ? { type: "remote", url: seam.endpoint, oauth: false as const }
    : { type: "remote", url: seam.endpoint, oauth: { scope: OAUTH_SCOPE } }

const parsed = (url: string) => {
  try {
    return new URL(url)
  } catch {
    return undefined
  }
}

const pathOf = (url: URL) => url.pathname.replace(/\/+$/, "")
/** A query as a comparable string; an absent query and an empty one are the same. */
const queryOf = (url: URL) => new URLSearchParams([...url.searchParams].sort(([a], [b]) => a.localeCompare(b))).toString()

/**
 * The query this server's identity rests on: `tools=all` is what makes Atlassian send one named tool per Jira tool, and
 * a plain `/v2/mcp` entry is the meta-tool server, whose tools this plugin's table does not describe.
 */
const TOOL_LIST_QUERY = "tools=all"

/**
 * Origin, path and query: the same server. A trailing slash still matches, and so does a reordered query; a missing or
 * different `?tools=all` does not, because that is another server's tool list.
 */
export function sameServer(url: string, expected: string) {
  const left = parsed(url)
  const right = parsed(expected)
  return left !== undefined && right !== undefined && left.origin === right.origin && pathOf(left) === pathOf(right) && queryOf(left) === queryOf(right)
}

/**
 * A server's address for status: origin and path, and the query only when it is the one this server's identity rests on.
 * Any other query can hold a token, so it never reaches status.
 */
export function displayUrl(url: string) {
  const target = parsed(url)
  if (!target) return "an invalid URL"
  const base = `${target.origin}${pathOf(target)}`
  return queryOf(target) === TOOL_LIST_QUERY ? `${base}?${TOOL_LIST_QUERY}` : base
}

/**
 * A conflicting server's address for status. Another origin shows only its origin, because its path can hold a secret,
 * as some servers' URLs do. Atlassian's own origin keeps its path and its `?tools=all`, so a wrong path or a missing
 * query there is visible.
 */
export function conflictUrl(url: string, expected: string) {
  const target = parsed(url)
  const expectedUrl = parsed(expected)
  if (!target || !expectedUrl) return "an invalid URL"
  if (target.origin === expectedUrl.origin) return displayUrl(url)
  return pathOf(target) === "" ? target.origin : `${target.origin}/…`
}

/**
 * Registers `jira`, or adopts the user's own `mcp.servers.jira` unchanged when it points at Atlassian's URL with the
 * `?tools=all` query: user config is applied first, and a later `set` would replace it. Of the user's entry only its
 * type, its URL and whether `oauth` is false are read, never its headers, which may hold a secret. Any other URL, a
 * v1 URL, a plain `/v2/mcp` entry or a local command, is a conflict, and nothing is added. Synchronous and never throws.
 */
export function registerServer(
  mcp: Pick<Plugin.Context["mcp"], "transform">,
  config: RemoteConfig,
  record: (source: ServerSource | undefined, problem?: string) => void,
) {
  return mcp.transform((editor) => {
    try {
      const existing = editor.get(SERVER_NAME)
      const expected = displayUrl(config.url)
      if (!existing) {
        editor.set(SERVER_NAME, config)
        return record({ type: "plugin", url: expected, signIn: "oauth" })
      }
      if (existing.type !== "remote") return record({ type: "conflict", url: "a local command", expected })
      const url = displayUrl(existing.url)
      const signIn = existing.oauth === false ? "own" : "oauth"
      record(sameServer(existing.url, config.url) ? { type: "adopted", url, signIn } : { type: "conflict", url: conflictUrl(existing.url, config.url), expected })
    } catch (error) {
      record(undefined, errorText("SERVER_NOT_REGISTERED", `The ${SERVER_NAME} MCP server could not be registered (${reasonOf(error)}).`, "Restart OpenCode."))
    }
  })
}

export function createJiraPlugin(seam: JiraSeam) {
  return Plugin.define({
    id: PLUGIN_ID,
    async setup(ctx) {
      const options = parseOptions(ctx.options)
      const host = checkHost(ctx.app.version, options.allowUntestedHost)
      const { skills, problems: skillProblems } = await loadSkills(seam.skillsDir)
      // Transforms replay on every rebuild, so each one overwrites its own entry rather than appending.
      const problems = new Map<string, string>(skillProblems.map((problem, index) => [`skill:${index}`, problem]))
      const report = (area: string) => (problem: string | undefined) => void (problem ? problems.set(area, problem) : problems.delete(area))
      let source: ServerSource | undefined

      await registerServer(ctx.mcp, serverConfig(seam), (next, problem) => {
        source = next
        report("server")(problem)
      })
      // The plugin's own server, or the user's adopted one; a server at another URL is not Jira's.
      const owned = () => source?.type === "plugin" || source?.type === "adopted"
      // Code Mode's catalog describes the server's namespace with this text; a server at another URL keeps its own.
      await ctx.tool.transform((editor) => void (source?.type === "conflict" ? undefined : editor.namespace({ name: SERVER_NAME, description: NAMESPACE_DESCRIPTION })))
      await registerDefaultRules(ctx.agent, defaultRules(), report("rules"))
      const listing = watchListing(ctx)
      // The account and site rows come from the user's own first calls; the plugin never calls Atlassian itself.
      const account = await watchAccount(ctx, () => source?.type === "adopted" && source.signIn === "own", owned)
      const own = skills.map((skill) => ({ id: skill.id, path: skill.path }))
      const read = () => readStatus(ctx, { ...(source ? { source } : {}), host, problems: [...problems.values()], skills: own, listing, account })
      await registerSkills(ctx.skill, skills)
      await registerStatusCommand(ctx, read)
      await registerStatusRpc(ctx.rpc, read)
      // Scripts call the known reads with no model, as a session and its agent.
      const stopTools = await registerToolsRpc(ctx, { mcp: { server: SERVER_NAME, managed: () => source?.type !== "conflict" } })
      const stopWatch = watchIntegration(ctx, owned)
      return async () => {
        await stopWatch()
        await stopTools()
        await listing.stop()
        await account.stop()
      }
    },
  })
}
