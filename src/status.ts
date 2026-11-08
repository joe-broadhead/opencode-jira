import type { Plugin, Rpc } from "@opencode/plugin"
import { codeText, OAUTH_SCOPE, PLUGIN_ID, SERVER_NAME, TESTED_HOSTS } from "./constants.js"
import { isSupportedHost, type HostCheck } from "./host-version.js"
import type { AdoptedScope } from "./plugin.js"
import { classify, DESTRUCTIVE_TOOLS, NOT_GRANTED_TOOLS, WRITE_TOOLS } from "./jira-tools.js"
import type { Account } from "./account.js"
import { ACCESS, defaultRules, unguardedAgents, type Access, type Rule } from "./permissions.js"
import { shortReason } from "./redact.js"
import { VERSION } from "./version.js"

/** The shared status labels in machine form; `/jira-status` shows them as `sign-in required` and so on. */
type State = "connected" | "sign_in_required" | "connecting" | "disabled" | "failed" | "not_configured" | "conflict"
/**
 * Who owns the `jira` server: this plugin, the user's own config (adopted unchanged), or a server at another URL
 * (`expected` is Atlassian's). URLs are shown as origin and path, with `?tools=all` when it is present. `signIn` is `own`
 * for an adopted entry with `oauth: false`, which signs in with an Atlassian API token in its headers.
 */
export type ServerSource =
  | { readonly type: "plugin"; readonly url: string; readonly signIn: "oauth" }
  | { readonly type: "adopted"; readonly url: string; readonly signIn: "oauth" | "own"; readonly scope: AdoptedScope }
  | { readonly type: "conflict"; readonly url: string; readonly expected: string }

interface SkillPath {
  readonly id: string
  readonly path: string
}

/** What status is built from. The TUI fills what it can see; fields it cannot see stay undefined. */
export interface StatusFacts {
  readonly server?: { readonly status: "connected" | "pending" | "disabled" | "failed" | "needs_auth"; readonly error?: string }
  readonly source?: ServerSource
  /** The display name and site names from the user's own account reads since OpenCode started, if any. */
  readonly account?: Account
  readonly host: HostCheck
  /** The names of the tools the `jira` server serves, without the `jira_` prefix. */
  readonly tools?: readonly string[]
  /**
   * The server's status changed moments ago: a server that just connected lists its tools shortly after, so no tools
   * yet means "still listing", not "none for this account".
   */
  readonly settling?: boolean
  readonly agents?: readonly { readonly id: string; readonly permissions: readonly Rule[] }[]
  readonly problems?: readonly string[]
  /** How much the default rules restrict: `all` allows every tool, the other values restrict by class. */
  readonly access?: Access
  /** The plugin's own skills, and the skills OpenCode lists; the listed one wins when both have an id. */
  readonly skills?: { readonly own: readonly SkillPath[]; readonly listed: readonly SkillPath[] }
}

/**
 * One status model for `/jira-status`, the `/jira` dialog and the status RPC. `version`, `host`, `state`,
 * `unguardedAgents` and `nextStep` are the fields every plugin of this family shares; the rest are Jira's own.
 */
export interface Status {
  /** The plugin's version. */
  readonly version: string
  readonly state: State
  /** How much the default rules restrict: `all` allows every tool, `ask-changes` asks for a change, `read-only` denies it. */
  readonly access: Access
  /** For a failed connection only: OpenCode's reason, on one line of at most 160 characters, URLs without their query. */
  readonly error?: string
  readonly source?: ServerSource
  /** The Atlassian account's display name, from the user's last account read; absent before one. */
  readonly account?: string
  /** The names of the sites the account reaches, from the user's last resources read; empty before one. */
  readonly sites: readonly string[]
  /** How many Jira tools OpenCode lists that the plugin knows. */
  readonly tools: number
  /**
   * The listed tools of the destructive class, such as editJiraEntityProperty: `access: "all"` allows them,
   * `ask-changes` asks for each, and `read-only` denies them. A later rule of the user's still wins.
   */
  readonly destructiveTools: readonly string[]
  /** @deprecated The family field's old name; it carries the same list as `destructiveTools`. */
  readonly deniedTools: readonly string[]
  /** Known reads the sign-in's scope does not grant, so Atlassian never lists them; empty for an entry of your own. */
  readonly notGranted: readonly string[]
  /** True while a server that just connected may still be listing its tools. */
  readonly listing: boolean
  /** How many of them the plugin does not know. */
  readonly unknownCount: number
  /** Up to 20 of the unknown tools' names, only those made of lowercase letters, digits and `_`. */
  readonly unknownTools: readonly string[]
  /** Agents where a new Jira tool would run without asking; empty when there are none. */
  readonly unguardedAgents: readonly string[]
  /** The plugin's skills that OpenCode loads from another file of the same id instead. */
  readonly shadowedSkills?: readonly SkillPath[]
  readonly host: HostCheck
  readonly problems: readonly string[]
  /** The one next step: the `Next step` row, "Nothing to do." when nothing is needed. */
  readonly nextStep: string
}

const SIGN_IN = `Run /connect and choose Jira, then press o or Enter to open the link (in a terminal, opencode mcp auth ${SERVER_NAME} opens it automatically; run it from the project folder, and if it answers MCP server not found: ${SERVER_NAME}, wait a few seconds and run it again).`

/** The default rules to paste into an agent's own permissions, one rule a line, as a JSON array body, for `access`. */
const agentRules = (access: Access) =>
  defaultRules(access)
    .map((rule, index, rules) => `  ${JSON.stringify(rule)}${index < rules.length - 1 ? "," : ""}`)
    .join("\n")

/** The next step while agents lack the rules: the family's one fixed sentence. */
const AGENTS_NEXT_STEP =
  "Put the default rules shown by /jira-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Jira tools."

const NOTHING_TO_DO = "Nothing to do."

/** What the two captured rows say before the user's own first read has happened. */
const NOT_READ_YET = "not read yet: it appears after the first Jira call since OpenCode started"

const TESTED_TEXT = `${TESTED_HOSTS.slice(0, -1).join(", ")} or ${TESTED_HOSTS.at(-1)}`
const LISTED_UNKNOWN = 20
/** How many site names the Sites row shows before it counts the rest. */
const LISTED_SITES = 6
// A tool name comes from the server; list only plain names.
const SAFE_NAME = /^[a-z][a-z0-9_]{0,63}$/

/** The plugin's skills that OpenCode lists from another file: a skill with the same id, such as a user's, replaced it. */
function shadowedOf(facts: StatusFacts): SkillPath[] {
  return (facts.skills?.own ?? []).flatMap((own) => {
    const listed = facts.skills?.listed.find((skill) => skill.id === own.id)
    return listed && listed.path !== own.path ? [{ id: own.id, path: listed.path }] : []
  })
}

const STATE_OF = { connected: "connected", pending: "connecting", needs_auth: "sign_in_required", failed: "failed", disabled: "disabled" } as const

export function buildStatus(facts: StatusFacts): Status {
  const state: State = facts.source?.type === "conflict" ? "conflict" : facts.server ? STATE_OF[facts.server.status] : "not_configured"
  const listed = facts.tools ?? []
  const unknown = listed.filter((tool) => classify(tool) === "unknown")
  const access = facts.access ?? "all"
  const destructive = listed.filter((tool) => classify(tool) === "destructive")
  // OpenCode's text for a needed sign-in can hold an authorization URL, so only a failure's reason is kept.
  const error = facts.server?.status === "failed" && facts.server.error ? shortReason(facts.server.error) : undefined
  const shadowed = shadowedOf(facts)
  // The plugin's scope is the second deny list. An adopted entry that repeats the pin keeps it, so only there does the
  // list still hold; one with no scope, or a wider one, must not be told it withholds anything.
  const withholds = facts.source?.type === "adopted" ? facts.source.scope === "pinned" : true
  const notGranted = withholds ? [...NOT_GRANTED_TOOLS] : []
  const status = {
    version: VERSION,
    state,
    access,
    ...(error ? { error } : {}),
    ...(facts.source ? { source: facts.source } : {}),
    ...(facts.account?.name?.trim() ? { account: facts.account.name.trim() } : {}),
    sites: [...(facts.account?.sites ?? [])],
    tools: listed.length,
    destructiveTools: destructive,
    deniedTools: destructive,
    notGranted,
    listing: state === "connected" && listed.length === 0 && facts.settling === true,
    unknownCount: unknown.length,
    unknownTools: unknown.filter((name) => SAFE_NAME.test(name)).slice(0, LISTED_UNKNOWN),
    unguardedAgents: unguardedAgents(facts.agents ?? [], access),
    ...(shadowed.length ? { shadowedSkills: shadowed } : {}),
    host: facts.host,
    problems: facts.problems ?? [],
  }
  return { ...status, nextStep: nextStepOf(status) }
}

function nextStepOf(status: Omit<Status, "nextStep">): string {
  const { source } = status
  switch (status.state) {
    case "conflict": {
      const { url, expected } = source as Extract<ServerSource, { type: "conflict" }>
      return `Your OpenCode config defines mcp.servers.${SERVER_NAME} with ${url}, but the plugin uses ${expected}. Point it at ${expected} or remove it, then restart OpenCode.`
    }
    case "not_configured":
      return `OpenCode has no ${SERVER_NAME} MCP server. Check that no organisation policy (mcp.use) or other plugin removes it, then restart OpenCode.`
    case "disabled":
      return `The ${SERVER_NAME} MCP server is disabled. Enable it in /mcps, or remove "disabled": true from mcp.servers.${SERVER_NAME} in opencode.json.`
    case "connecting":
      return "Jira is still connecting. Run /jira-status again in a few seconds."
    case "sign_in_required":
      return SIGN_IN
    case "failed":
      // An entry with its own sign-in sends an Atlassian API token in its headers, which the plugin never reads.
      if (source?.type === "adopted" && source.signIn === "own") {
        return `Check the API token in the headers of your mcp.servers.${SERVER_NAME} (Atlassian: id.atlassian.com, Security, API tokens), then restart OpenCode.`
      }
      return "Check your network, then run /jira-status again."
  }
  if (status.listing) return "Jira is still listing its tools. Run /jira-status again in a few seconds."
  if (status.tools === 0 && status.deniedTools.length === 0) {
    return "Ask an organisation admin to allow Read and Search for Atlassian MCP in Atlassian Administration, Connectors, Atlassian MCP server, Permissions, then run /jira-status again."
  }
  if (status.unguardedAgents.length) return AGENTS_NEXT_STEP
  // A problem reads `CODE: What happened. Next step: What to do.`; its own next step becomes the status's.
  const problem = status.problems[0]?.split(" Next step: ")[1]
  if (problem) return problem
  if (status.shadowedSkills?.length) {
    return `Rename or move ${status.shadowedSkills.map((skill) => `the "${skill.id}" skill at ${skill.path}`).join(" and ")}, which OpenCode loads instead of the plugin's skill of the same name.`
  }
  // An untested host changes no next step: the OpenCode row says it is untested.
  return NOTHING_TO_DO
}

const STATE_TEXT: Record<State, string> = {
  connected: "connected",
  connecting: "connecting",
  sign_in_required: "sign-in required",
  failed: "failed",
  disabled: "disabled",
  not_configured: "not configured",
  conflict: "conflict",
}

/** The permission posture, which the default rules fix. */
const RULES_NOT_ADDED = "RULES_NOT_ADDED:"

/** The server's address and owner, after the state label. */
function serverText(source: ServerSource) {
  if (source.type === "plugin") return `${source.url}, registered by this plugin`
  if (source.type === "adopted") return `${source.url}, your own mcp.servers.${SERVER_NAME}${source.signIn === "own" ? " without OAuth" : ""}, used unchanged`
  return `your mcp.servers.${SERVER_NAME} points at ${source.url}`
}

function toolsText({ tools, unknownCount, unknownTools, destructiveTools, notGranted, listing, access }: Status) {
  if (listing) return "none listed yet (Jira is still listing them)"
  const posture = destructiveTools.length
    ? `; ${list(destructiveTools)} ${access === "all" ? "allowed like everything else" : access === "ask-changes" ? "ask" : "denied"}`
    : ""
  const ungranted = notGranted.length ? `; not granted by scope: ${list(notGranted)}` : ""
  if (unknownCount === 0) return `${tools} available, 0 unknown${posture}${ungranted}`
  const more = unknownCount - unknownTools.length
  const names = unknownTools.length ? `: ${unknownTools.join(", ")}${more > 0 ? ` and ${more} more` : ""}` : ""
  return `${tools} available, ${unknownCount} unknown${names} (a tool Atlassian adds is ${access === "all" ? "allowed at once" : access === "ask-changes" ? "asked about" : "denied"})${posture}${ungranted}`
}

const list = (names: readonly string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`)

/** The Sites row: the names the user's own resources read returned, or a note that it has not run. */
function sitesText(sites: readonly string[]) {
  if (!sites.length) return NOT_READ_YET
  const more = sites.length - LISTED_SITES
  return `${sites.length} ${sites.length === 1 ? "site" : "sites"}: ${sites.slice(0, LISTED_SITES).join(", ")}${more > 0 ? ` and ${more} more` : ""}`
}

/**
 * The permission posture the default rules fix, derived from the tool lists so it cannot go stale, and whether those
 * rules are in place: facts status can check, not a fixed claim.
 */
const postureOf = (access: Access) =>
  access === "all"
    ? "every Jira tool is allowed, reads and changes alike"
    : access === "ask-changes"
      ? `reads run without asking; the ${WRITE_TOOLS.length} writes and the ${DESTRUCTIVE_TOOLS.length} destructive tools ask first`
      : `reads run without asking; the ${WRITE_TOOLS.length} writes and the ${DESTRUCTIVE_TOOLS.length} destructive tools are denied`

const PIN_FIX = `"oauth": { "scope": "${OAUTH_SCOPE}" }`

/**
 * The scope half of the Access row. For the plugin's own request, and for an adopted entry that repeats the pin, it names
 * the reads the request leaves out, from `status.notGranted`. An adopted entry with no scope, a wider one or a narrower
 * one says so plainly with the one-line fix, and never claims to withhold anything: only the entry's own request decides.
 */
function scopeText(status: Status): string {
  const left = status.notGranted.length ? `, and ${list(status.notGranted)} ${status.notGranted.length === 1 ? "is" : "are"} not granted either` : ""
  const { source } = status
  if (source?.type !== "adopted") return left
  switch (source.scope) {
    case "pinned":
      return left
    case "token":
      return "; your own mcp.servers.jira signs in with an API token, whose scopes and not this plugin's request set the grant"
    case "missing":
      return `; your own mcp.servers.jira asks for no OAuth scope, so OpenCode requests every scope Atlassian advertises: add ${PIN_FIX} to it and sign in again`
    case "wider":
      return `; your own mcp.servers.jira asks for more than this plugin's six scopes, so the grant may cover delete, manage or Confluence: use exactly ${PIN_FIX} and sign in again`
    case "narrower":
      return `; your own mcp.servers.jira asks for less than this plugin's scopes, so some reads may be missing: use exactly ${PIN_FIX} and sign in again`
  }
}

function accessText(status: Status) {
  const { access, problems, unguardedAgents } = status
  const rules = problems.some((problem) => problem.startsWith(RULES_NOT_ADDED))
    ? "default rules not added (see the OpenCode row)"
    : unguardedAgents.length
      ? "default rules missing in the agents listed below"
      : "every agent has the block"
  return `access ${access}: ${postureOf(access)}${scopeText(status)}; ${rules}`
}

/** The OpenCode row: the version, whether it is tested, the supported range, then any setup problems. */
function hostText({ host, problems }: Status) {
  const { version, range, tested } = host
  const outside = version === null || !isSupportedHost(version)
  const notes = [
    ...(outside ? [`It is outside the supported range; the plugin runs because allowUntestedHost is true. If Jira misbehaves, use OpenCode ${TESTED_TEXT}.`] : []),
    ...problems,
  ]
  return `${version ?? "unknown version"} (${tested ? "tested" : "untested"}; supported range ${range})${notes.length ? `. ${notes.join(" ")}` : ""}`
}

export function formatStatus(status: Status) {
  const { source, unguardedAgents: agents } = status
  const details = [status.error, source && serverText(source), status.listing && "still listing its tools"].filter(Boolean).join("; ")
  return [
    "Jira status",
    `- Connection: ${STATE_TEXT[status.state]}${details ? ` (${details})` : ""}`,
    `- Account: ${status.account ?? NOT_READ_YET}`,
    `- Access: ${accessText(status)}`,
    `- Sites: ${sitesText(status.sites)}`,
    `- Tools: ${toolsText(status)}`,
    `- Agents without default rules: ${agents.length ? `${agents.join(", ")}\n${agentRules(status.access)}` : "none"}`,
    `- OpenCode: ${hostText(status)}`,
    `- Next step: ${status.nextStep}`,
  ].join("\n")
}

/** The host reads status makes: four lists, and no Atlassian call. The account and sites come from the user's own. */
export interface StatusContext {
  readonly mcp: Pick<Plugin.Context["mcp"], "list">
  readonly agent: Pick<Plugin.Context["agent"], "list">
  readonly tool: Pick<Plugin.Context["tool"], "list">
  readonly skill: Pick<Plugin.Context["skill"], "list">
}

/** When the server's status last changed, or the watcher started, in milliseconds since the epoch. */
interface ListingState {
  readonly changedAt: () => number
}

/** The captured account: what the user's last two account reads said, and a way to forget it once signed out. */
interface AccountState {
  readonly current: () => Account | undefined
  readonly forget: () => void
}

/** How long after a status change no tools still means "listing". */
const LISTING_MS = 15_000

/** Reads the live facts through public host APIs; never calls Atlassian. Optional lookups that fail leave their field empty. */
export async function readStatus(
  ctx: StatusContext,
  facts: Pick<StatusFacts, "source" | "host" | "problems"> & { readonly skills?: readonly SkillPath[]; readonly listing?: ListingState; readonly account?: AccountState; readonly access?: Access },
) {
  const [servers, agents, tools, listed] = await Promise.all([
    ctx.mcp.list(),
    ctx.agent.list(),
    ctx.tool.list(),
    // The skill check is advice; a failed list must not hide the rest of the status.
    ctx.skill.list().then(
      (result) => result.data,
      () => undefined,
    ),
  ])
  const server = servers.data.find((entry) => entry.name === SERVER_NAME)
  // A server that needs a new sign-in may come back as another account.
  if (server?.status.status === "needs_auth") facts.account?.forget()
  const account = facts.account?.current()
  const { skills: own, listing, account: watched, access, ...rest } = facts
  const settling = listing !== undefined && Date.now() - listing.changedAt() < LISTING_MS
  return buildStatus({
    ...rest,
    access: access ?? "all",
    ...(server ? { server: server.status } : {}),
    ...(account ? { account } : {}),
    tools: tools.filter((tool) => tool.options?.namespace === SERVER_NAME).map((tool) => tool.name),
    settling,
    agents: agents.data,
    ...(own && listed ? { skills: { own, listed } } : {}),
  })
}

/** Why status could not be read: a coded message and its next step. The reason is cut like a failure's. */
function unavailable(error: unknown) {
  const reason = shortReason(error instanceof Error ? error.message : String(error))
  return {
    message: codeText("STATUS_UNAVAILABLE", `Could not read Jira's status${reason ? ` (${reason})` : ""}.`),
    nextStep: "Restart OpenCode, then run /jira-status again.",
  }
}

const strings = { type: "array", items: { type: "string" } }
const count = { type: "integer", minimum: 0 }
const nullableString = { type: ["string", "null"] }

/**
 * One read-only method for the TUI view and scripts. The TUI part does not receive the plugin options on 2.2.x, and
 * cannot see the server's own findings, so it asks the server for the same status /jira-status reports.
 */
export const StatusRpc = {
  id: PLUGIN_ID,
  methods: {
    status: {
      input: { type: "object" },
      output: {
        type: "object",
        required: ["version", "access", "state", "sites", "tools", "deniedTools", "notGranted", "listing", "unknownCount", "unknownTools", "unguardedAgents", "host", "problems", "nextStep"],
        properties: {
          version: { type: "string" },
          access: { enum: [...ACCESS] },
          state: { enum: ["connected", "sign_in_required", "connecting", "disabled", "failed", "not_configured", "conflict"] },
          error: { type: "string" },
          source: {
            type: "object",
            required: ["type", "url"],
            properties: {
              type: { enum: ["plugin", "adopted", "conflict"] },
              url: { type: "string" },
              expected: { type: "string" },
              signIn: { enum: ["oauth", "own"] },
              scope: { enum: ["pinned", "missing", "wider", "narrower", "token"] },
            },
          },
          account: { type: "string" },
          sites: strings,
          tools: count,
          destructiveTools: strings,
          deniedTools: strings,
          notGranted: strings,
          listing: { type: "boolean" },
          unknownCount: count,
          unknownTools: strings,
          unguardedAgents: strings,
          shadowedSkills: {
            type: "array",
            items: { type: "object", required: ["id", "path"], properties: { id: { type: "string" }, path: { type: "string" } } },
          },
          host: {
            type: "object",
            required: ["version", "range", "tested"],
            properties: { version: nullableString, range: { type: "string" }, tested: { type: "boolean" } },
          },
          problems: strings,
          nextStep: { type: "string" },
        },
      },
      errors: { unavailable: { type: "object", required: ["nextStep"], properties: { nextStep: { type: "string" } } } },
    },
  },
  events: {},
} satisfies Rpc.PortableDefinition

export function registerStatusRpc(rpc: Pick<Plugin.Context["rpc"], "register">, read: () => Promise<Status>) {
  return rpc.register(StatusRpc, {
    status: (_input, { error }) =>
      read().catch((cause: unknown) => {
        const { message, nextStep } = unavailable(cause)
        return error("unavailable", message, { nextStep })
      }),
  })
}

export function registerStatusCommand(
  ctx: { readonly command: Pick<Plugin.Context["command"], "transform">; readonly session: Pick<Plugin.Context["session"], "synthetic"> },
  read: () => Promise<Status>,
) {
  return ctx.command.transform((editor) =>
    editor.add({
      name: "jira-status",
      description: "Show Jira's connection, sign-in, account, sites, tools and the next step",
      execute: async ({ sessionID }) => {
        const text = await read().then(formatStatus, (cause: unknown) => {
          const { message, nextStep } = unavailable(cause)
          return `${message} Next step: ${nextStep}`
        })
        await ctx.session.synthetic({ sessionID, text, description: "Jira status", resume: false })
      },
    }),
  )
}
