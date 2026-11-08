import type { Plugin } from "@opencode/plugin"
import { cut, oneLine } from "./redact.js"
import { SERVER_NAME } from "./constants.js"
import { delay, RESUBSCRIBE_MS } from "./watch.js"

/**
 * What status shows about the signed-in Atlassian account: the display name from the last `atlassianUserInfo` result,
 * and the names of the sites the last `getAccessibleAtlassianResources` result listed. Nothing else of either result is
 * read: no email address, account id, avatar URL, cloud id, app or scope. Kept in memory only.
 */
export interface Account {
  readonly name?: string
  readonly sites?: readonly string[]
}

/** The two account reads. The plugin never calls them itself: the user's first request calls them anyway. */
export const ACCOUNT_TOOL = "atlassianUserInfo"
export const SITES_TOOL = "getAccessibleAtlassianResources"

/** The longest account name status shows, and the longest site name. */
const NAME_LIMIT = 80
const SITE_LIMIT = 40
/** How many site names are kept; the Sites row counts them all. */
const SITES_KEPT = 10

type Result = { readonly output?: unknown; readonly content?: unknown }

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

function parse(value: unknown): unknown {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function text(content: unknown): string | undefined {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return undefined
  return content.flatMap((part) => (record(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : [])).join("\n")
}

/** The result's structured output and its text, parsed, at the top level; the account fields are searched inside them. */
function parsedOutputs(result: Result): unknown[] {
  return [parse(result.output), parse(text(result.content))]
}

/** The fields of a result: the top-level object, then each object it holds directly. */
function objects(result: Result): Record<string, unknown>[] {
  return parsedOutputs(result).flatMap((value) => {
    if (Array.isArray(value)) return value.filter(record)
    if (!record(value)) return []
    return [value, ...Object.values(value).filter(record)]
  })
}

const clean = (text: string, limit: number) => cut(oneLine(text), limit)
const NAME_FIELDS = ["name", "displayName", "display_name", "nickname", "publicName", "accountName"] as const

/**
 * The display name from an `atlassianUserInfo` result, if the result carries one. The tool declares no output schema, so
 * the shape stays unconfirmed until a live call: a result in another shape leaves the row "not read yet", never wrong.
 */
export function nameOf(result: Result): string | undefined {
  for (const fields of objects(result)) {
    for (const key of NAME_FIELDS) {
      const value = fields[key]
      const name = typeof value === "string" ? clean(value, NAME_LIMIT) : ""
      if (name) return name
    }
  }
  return undefined
}

/** A site is a record with a name and a cloud id or a URL; that is how Atlassian describes the resources list. */
const isSite = (value: unknown): value is Record<string, unknown> =>
  record(value) && typeof value.name === "string" && (typeof value.id === "string" || typeof value.url === "string" || typeof value.cloudId === "string")

/**
 * The site names from a `getAccessibleAtlassianResources` result, in its order, deduplicated, at most ten. An empty list
 * is a real answer: the account reaches no site. Nothing else of a site is read.
 */
export function sitesOf(result: Result): string[] | undefined {
  for (const value of parsedOutputs(result)) {
    const lists: unknown[] = [value, ...(record(value) ? Object.values(value) : [])]
    // An empty list is an answer: the account reaches no site. A list of other things is not a site list.
    const sites = lists.find((value) => Array.isArray(value) && (value.length === 0 || value.some(isSite)))
    if (!Array.isArray(sites)) continue
    const names = sites.filter(isSite).map((site) => clean(site.name as string, SITE_LIMIT)).filter(Boolean)
    return [...new Set(names)].slice(0, SITES_KEPT)
  }
  return undefined
}

interface Capture {
  readonly capture: (tool: string, result: Result) => void
  /** The instance's server is the user's own entry without OAuth, which signs in with its own API token. */
  readonly ownSignIn: () => boolean
  /** The instance's `jira` server is Atlassian's: a server at another URL is not, and its results say nothing. */
  readonly owned: () => boolean
}

/**
 * Every running plugin instance's capture. The tools RPC's reads skip the `execute.after` hook, and its result shaping
 * learns neither the instance nor the location that served the call, so it tells every instance. That is right only
 * while they share OpenCode's one Atlassian sign-in. An instance whose project adopts its own entry with an API token may
 * be another person's account, so while any instance does, a script's account read updates no status: the model path,
 * whose hook belongs to its own instance, still does.
 */
const captures = new Set<Capture>()

/** Records the account or the sites from a result that a script read through the tools RPC. */
export function captureAccount(tool: string, result: Result): void {
  if ([...captures].some((item) => item.ownSignIn())) return
  for (const item of captures) if (item.owned()) item.capture(tool, result)
}


/**
 * Captures the account and its sites from the model's own calls to the two account reads, and from the tools RPC's, and
 * forgets them when the user signs out or switches accounts. Makes no Atlassian call. Returns the current values and a
 * cleanup.
 */
export async function watchAccount(
  ctx: {
    readonly tool: Pick<Plugin.Context["tool"], "hook">
    readonly mcp: Pick<Plugin.Context["mcp"], "list">
    readonly event: Pick<Plugin.Context["event"], "subscribe">
  },
  ownSignIn: () => boolean = () => false,
  owned: () => boolean = () => true,
) {
  let account: Account = {}
  const capture = (tool: string, result: Result) => {
    if (tool === ACCOUNT_TOOL) {
      const name = nameOf(result)
      if (name) account = { ...account, name }
    } else if (tool === SITES_TOOL) {
      const sites = sitesOf(result)
      if (sites) account = { ...account, sites }
    }
  }
  const hook = await ctx.tool.hook("execute.after", async (event) => {
    const tool = [ACCOUNT_TOOL, SITES_TOOL].find((name) => event.tool === `${SERVER_NAME}_${name}`)
    if (tool && event.status === "completed" && owned()) capture(tool, event.result)
  })
  const entry: Capture = { capture, ownSignIn, owned }
  captures.add(entry)

  const stopped = new AbortController()
  // Signed out (the server needs a sign-in again) or another account: what was read no longer holds.
  const check = async () => {
    const server = (await ctx.mcp.list()).data.find((item) => item.name === SERVER_NAME)
    if (server?.status.status !== "connected" && server?.status.status !== "pending") account = {}
  }
  const watching = (async () => {
    while (!stopped.signal.aborted) {
      try {
        const events = ctx.event.subscribe({ types: ["mcp.status.changed", "credential.switched"], signal: stopped.signal })
        for await (const event of events) {
          if (event.type === "credential.switched") account = {}
          else if (event.data.server === SERVER_NAME) await check().catch(() => undefined)
        }
      } catch {
        // The stream failed; subscribe again.
      }
      await delay(RESUBSCRIBE_MS, stopped.signal)
    }
  })()

  return {
    current: () => (Object.keys(account).length ? account : undefined),
    /** Forgets the account, for a status read that finds the server signed out. */
    forget: () => void (account = {}),
    stop: async () => {
      stopped.abort()
      captures.delete(entry)
      await watching
      await hook.dispose()
    },
  }
}
