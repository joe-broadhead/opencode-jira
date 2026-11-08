// Every fact the plugin keeps about Jira's tools: their names, without the `jira_` server prefix, sorted by name within
// what they do. The default rules, the tools RPC's methods, status's unknown and destructive tools and the tests all derive
// from these lists; `jelly.tools` in package.json and the skills' call examples are checked against them. Keep this file
// free of runtime imports.
//
// The names come from Atlassian's own list of its v2 MCP tools (support.atlassian.com, "Supported tools"), recorded in
// test/unit/live-tools.json; the drift test pins them to it. That list gives no schemas and no annotations, so each
// tool's class comes from Atlassian's description of it, and PARAMETERS stays empty until a tool list from a signed-in
// server is recorded (CONTRIBUTING.md, "Drift check"). Atlassian loads only the tools the grant covers, so a known tool
// missing from a live list is normal and never reported.

/**
 * Known reads: each only reads, by Atlassian's description, and sends nothing to anyone. `access: "all"` and
 * `ask-changes` allow them; `read-only` allows them too, being the one class it leaves alone.
 *
 * `atlassianUserInfo` and `getAccessibleAtlassianResources` are Atlassian's common tools, not Jira ones: every Jira call
 * needs a `cloudId` from the second, so both must run unasked or each session would start with a prompt.
 *
 * The three `manage_jira` reads are listed because they only read, but the pinned scope does not grant `manage_jira`,
 * so Atlassian never loads them: they are normally absent, which is normal and never drift.
 */
export const READ_TOOLS: readonly string[] = [
  "atlassianUserInfo",
  "getAccessibleAtlassianResources",
  "getJiraBoardConfig",
  "getJiraBoardIssueData",
  "getJiraBoardSprintData",
  "getJiraCurrentUser",
  "getJiraEntityProperty",
  "getJiraIssue",
  "getJiraIssueTypeMetaWithFields",
  "getJiraProjectVersionRelatedWork",
  "getJiraProjectVersions",
  "getJiraScreen",
  "getJiraUser",
  "getJiraWorkflowEditorLink",
  "getJiraWorkflows",
  "listJiraBoardSprints",
  "listJiraBoards",
  "listJiraDashboards",
  "listJiraFilters",
  "listJiraIssueAssignableUsers",
  "listJiraIssueChangelogs",
  "listJiraIssueComments",
  "listJiraIssueLinkTypes",
  "listJiraIssueRemoteIssueLinks",
  "listJiraIssueTransitions",
  "listJiraIssueWorklogs",
  "listJiraProjectComponents",
  "listJiraProjectIssueTypesMetadata",
  "listJiraProjects",
  "listJiraStatuses",
  "lookupJiraAccountId",
  "searchJiraIssuesUsingJql",
]

/**
 * Known writes. Every one can email people: a project's notification scheme decides, and the safe assumption is that
 * watchers, the assignee, the reporter and everyone mentioned are emailed. Two of them are four or five operations
 * behind one name, so a rule cannot see which one a call makes: the skill names the operation. `access: "all"` allows
 * them like everything else; `ask-changes` asks for each call and `read-only` denies them.
 */
export const WRITE_TOOLS: readonly string[] = [
  "addOrEditJiraIssueComment",
  "addOrEditJiraIssueWorklog",
  "convertJiraIssueHierarchy",
  "createJiraBoard",
  "createJiraIssue",
  "createJiraIssueLink",
  "createJiraIssueRemoteIssueLink",
  "editJiraIssue",
  "manageJiraProjectVersion",
  "manageJiraProjectVersionRelatedWork",
  "manageJiraSprint",
  "transitionJiraIssue",
  "uploadAttachmentToJiraIssue",
  "watchJiraIssue",
]

/**
 * The destructive class: allowed by default like every other tool, and what `access: "read-only"` denies and
 * `access: "ask-changes"` asks for on each call. A later rule of the user's still turns one back on.
 * - `deleteJiraIssue`, `deleteJiraComment` and `deleteJiraIssueAttachment` delete permanently, which cannot be undone.
 * - `createJiraProject`, `updateJiraProject` and `updateJiraScreen` are administration: a new organisation-visible
 *   container, its settings for everyone in it, or the fields everyone in the project can see and edit.
 * - `editJiraEntityProperty` writes opaque key/value state that other Jira apps and integrations read, and can target a
 *   user. No one asks for it in words, and a stray write can corrupt an app's stored state.
 *
 * The first six are also not granted by scope, so Atlassian never loads them: the rule is the second lock.
 */
export const DESTRUCTIVE_TOOLS: readonly string[] = [
  "createJiraProject",
  "deleteJiraComment",
  "deleteJiraIssue",
  "deleteJiraIssueAttachment",
  "editJiraEntityProperty",
  "updateJiraProject",
  "updateJiraScreen",
]

/**
 * Known reads that the pinned scope does not grant: `getJiraWorkflows`, `getJiraWorkflowEditorLink` and `getJiraScreen`
 * sit in Atlassian's `manage_jira` group, and the sign-in requests no `manage:jira:agent-interface`. Status says they are
 * not granted rather than calling them missing; they stay methods, and `describe` reports each unavailable.
 */
export const NOT_GRANTED_TOOLS: readonly string[] = ["getJiraScreen", "getJiraWorkflowEditorLink", "getJiraWorkflows"]

/**
 * Each known tool's input parameters, as `name:type`, with `*` after a required name, in the input schema's order. Empty
 * until a tool list from a signed-in server is recorded: Atlassian publishes no schemas. The drift script compares a
 * saved tool list with this record and lists every tool still to record; the skills test lets a skill write a literal
 * call only with parameters recorded here, so until then the skills name tools without their inputs.
 */
export const PARAMETERS: Readonly<Record<string, readonly string[]>> = {}

/**
 * The export class: a tool that mints a secret, such as a short-lived signed URL. It is a change, not a read, so
 * `access: "all"` allows it, `ask-changes` asks for each call, and `read-only` denies it.
 */
export const EXPORT_TOOLS: readonly string[] = ["downloadJiraIssueAttachment"]

/** Every known tool, in the order the default rules list them. */
export const ALL_TOOLS: readonly string[] = [...READ_TOOLS, ...EXPORT_TOOLS, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS]

type ToolClass = "read" | "write" | "export" | "destructive" | "unknown"

export function classify(name: string): ToolClass {
  if (READ_TOOLS.includes(name)) return "read"
  if (WRITE_TOOLS.includes(name)) return "write"
  if (EXPORT_TOOLS.includes(name)) return "export"
  if (DESTRUCTIVE_TOOLS.includes(name)) return "destructive"
  return "unknown"
}
