/**
 * Jira's part of the tools RPC (`jira.issues.tools`): the plugin value and the method table that the source contract's
 * `tools-rpc` module takes. The module (`@we-the-rebel-alliance/source-contract/tools-rpc`, bundled into
 * `dist/index.js`) is the transport every plugin of the family shares:
 *
 *   POST /api/rpc/jira.issues.tools/<method>
 *   { "input": { "sessionID": "<session>", "input": <the tool's input> } }
 *
 * A script runs as a session and the agent it names; the rule for the method's permission action is resolved before
 * dispatch, and only `allow` runs. An MCP method then runs through OpenCode's own executor, which checks
 * `jira_<tool>` against the same rules and sends OpenCode's own credential; `events_list` and `probe` run their own
 * specs. `docs/scripting.md` describes the calls.
 */
import { SourceError } from "@we-the-rebel-alliance/source-contract/events"
import { toolsRpcId, type Failure, type McpResult, type MethodSpec, type NextSteps, type ShapeCall, type ToolsRpcPlugin } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { captureAccount, ACCOUNT_TOOL, SITES_TOOL } from "./account.js"
import { DESTRUCTIVE_TOOLS, EXPORT_TOOLS, READ_TOOLS, WRITE_TOOLS } from "./jira-tools.js"
import { PLUGIN_ID as JIRA_PLUGIN_ID, SERVER_NAME } from "./constants.js"

/** The plugin's id. The RPC id is `<PLUGIN_ID>.tools`. */
export const PLUGIN_ID = JIRA_PLUGIN_ID

/** The RPC's id: the plugin's id and `.tools`. Scripts call it by name, so it never changes. */
export const TOOLS_RPC_ID = toolsRpcId(PLUGIN_ID)

/**
 * Every known Jira tool, by exact name, from the plugin's one table: the reads, the export that mints a signed URL, the
 * writes, and the seven of the destructive class. The three reads the pinned scope does not grant are methods too: Atlassian does not
 * list them, so `describe` reports them unavailable with the connection state, and a call has no tool to run. A tool
 * Atlassian adds later is never a method until it is classified in `src/jira-tools.ts`. The class never decides whether
 * a call runs: the rules do. The source's `events_list` and `probe` are `kind: "plugin"` methods, built in setup.
 */
export const METHODS: readonly MethodSpec[] = [
  ...READ_TOOLS.map((name): MethodSpec => ({ kind: "mcp", name, class: "read" })),
  ...EXPORT_TOOLS.map((name): MethodSpec => ({ kind: "mcp", name, class: "export" })),
  ...WRITE_TOOLS.map((name): MethodSpec => ({ kind: "mcp", name, class: "write" })),
  ...DESTRUCTIVE_TOOLS.map((name): MethodSpec => ({ kind: "mcp", name, class: "destructive" })),
]

/** What the model path's `execute.before` hooks do to an MCP call's arguments. Jira has no such hook. */
export function shapeInput(_method: string, input: unknown, _call: ShapeCall): unknown {
  return input
}

/**
 * What the model path's `execute.after` hook does to a result, which the executor skips: the two account reads record the
 * display name and the site names that status shows, with the hook's own function. The result itself is unchanged.
 */
export function shapeResult(method: string, result: McpResult, _call: ShapeCall): McpResult {
  if (method === ACCOUNT_TOOL || method === SITES_TOOL) captureAccount(method, { output: result.output, content: result.text })
  return result
}

/** The next step for each code. Each is one sentence that ends with a full stop. */
export const NEXT_STEPS: NextSteps = {
  SESSION_UNKNOWN: `Create a session in the location you mean, such as POST /api/session with {"agent":"build"} sent with the header "x-opencode-directory: <dir>" or the location[directory] query, and pass its id.`,
  SESSION_AGENT_REQUIRED: `Create a session that names an agent this project has, with its project as the location, such as POST /api/session with {"agent":"build","location":{"directory":"/path/to/project"}}, and pass its id.`,
  PERMISSION_DENIED: "Add an allow rule for the tool to the session's agent or to the session, or use a session whose agent allows it.",
  SERVER_CONFLICT: `Run /jira-status, then point your own mcp.servers.${SERVER_NAME} in opencode.json at the "?tools=all" URL it names or remove it, and restart OpenCode.`,
  AUTH_REQUIRED: `Run /connect and choose Jira, then press o or Enter to open the link (in a terminal, opencode mcp auth ${SERVER_NAME} opens it automatically; run it from the project folder, and if it answers MCP server not found: ${SERVER_NAME}, wait a few seconds and run it again).`,
  CONNECTING: "Wait a few seconds, then call the method again.",
  CONNECTION_FAILED: "Check your network, then run /jira-status and follow its next step.",
  DISABLED: `Enable the ${SERVER_NAME} server in /mcps, or remove "disabled": true from mcp.servers.${SERVER_NAME} in opencode.json.`,
  NOT_REGISTERED: "Run /jira-status and follow its next step.",
  TOOL_UNAVAILABLE: "Call describe to see which methods OpenCode lists now, and run /jira-status.",
  UPSTREAM_ERROR: "Check the input against the method's schema from describe; if Atlassian reports a rate limit, wait for the Retry-After seconds and make fewer calls at once.",
  CANCELLED: "Call the method again if you still need the result.",
}

/**
 * The plugin's own errors, thrown by the `events_list` and `probe` methods' specs as the source contract's
 * `SourceError`: its code, what happened and the next step.
 */
export function pluginError(error: unknown): Failure | undefined {
  return error instanceof SourceError ? { code: error.code, what: error.what, next: error.next } : undefined
}

/** Jira's plugin value for the tools RPC. */
export const PLUGIN: ToolsRpcPlugin = { id: PLUGIN_ID, nextSteps: NEXT_STEPS, shapeInput, shapeResult, pluginError }
