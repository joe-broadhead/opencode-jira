# In Jelly

[Jelly](https://heyjelly.ai) runs OpenCode agents. It reads the `jelly` section of this package's `package.json` as
JSON, without loading the plugin, when a person reviews the exact version, and uses it as follows.

Jelly names the plugin **Jira** (`jelly.title`), with the package name and version beneath. Under that name it shows the
one line in `jelly.summary`, and beside it the mark in `jelly.icon` (`assets/icon.svg`, shipped in the package): Jelly
reads that file once, when it records the plugin, and keeps it only if it is a clean SVG of drawing elements, with no
script, style, link or outside reference. The mark is a neutral kanban board of cards on a grey tile, not Atlassian's
logo. Jelly's declaration contracts drop a top-level key they don't know, and refuse an unknown key inside a tool,
sign-in or `contributes` entry, so the section uses only the keys Jelly reads.

## Tools and permissions

54 tools are declared (33 read-only), every tool in `src/jira-tools.ts`: each read tool as read-only with `allow`, each
write tool with `ask`, and each denied tool with `deny`. Jelly's agents have no base "allow everything" rule, so this
plugin's own default rules, which it puts after that rule, never reach them. Jelly writes each declared `ask` or `deny`
as that tool's default instead (the person's own choice replaces it), and denies a read-only helper every tool not marked
`readOnly`. A declared `allow` changes nothing in Jelly.

- Ask, the 14 changes: `jira_addOrEditJiraIssueComment`, `jira_addOrEditJiraIssueWorklog`,
  `jira_convertJiraIssueHierarchy`, `jira_createJiraBoard`, `jira_createJiraIssue`, `jira_createJiraIssueLink`,
  `jira_createJiraIssueRemoteIssueLink`, `jira_editJiraIssue`, `jira_manageJiraProjectVersion`,
  `jira_manageJiraProjectVersionRelatedWork`, `jira_manageJiraSprint`, `jira_transitionJiraIssue`,
  `jira_uploadAttachmentToJiraIssue` and `jira_watchJiraIssue`. Every one can email watchers, the assignee, the
  reporter and anyone the text mentions.
- Off: `jira_deleteJiraIssue`, `jira_deleteJiraComment` and `jira_deleteJiraIssueAttachment` (permanent, with no
  history to restore), `jira_createJiraProject`, `jira_updateJiraProject` and `jira_updateJiraScreen` (a new space, or
  settings and fields that reach everyone in a project), and `jira_editJiraEntityProperty` (opaque state other Jira
  apps read).
- Everything else runs, as the plugin's own rules let it.

Three of the declared reads, `jira_getJiraWorkflows`, `jira_getJiraWorkflowEditorLink` and `jira_getJiraScreen`, are
normally absent: the sign-in asks for no `manage_jira` scope, so Atlassian never loads them.

A tool Atlassian adds later, a write included, is not declared, so in Jelly it is not asked about: it runs without asking,
even if it changes something, until a new version of this plugin declares it. Atlassian says it adds tools over time,
write actions included. A Jelly admin can set such a tool to ask. Keep `jelly.tools` in step with `src/jira-tools.ts`;
`test/unit/jelly.test.ts` checks the list against it, and each declared effect against the plugin's own default rules.

## Skills

Declared: `jira`, `jira-write`. Jelly refuses an install whose skill ids collide with another plugin's or the agent's
own; they differ from the linear, github, metaview, granola, wisprflow and plaud skills, which answer for other trackers
and for meetings.

## Views

None: `jelly.views` and `jelly.rpc` are empty, and the plugin contributes no Home feed or widget. A feed of work items
would put a project's tickets on a dashboard and call Jira unasked, and a widget would need a site before the user has
chosen one.

## Signing in

`jelly.signIns` declares one sign-in, `jira`, for Atlassian's MCP server `jira`, which signs in with OpenCode's MCP OAuth.
One sign-in may reach several sites; the plugin asks which one once, and Jelly's card signs in or out without changing
that.

Jelly folds the declared sign-in into this plugin's one card, which shows it as Connected, Not signed in or Sign in
again (expired or revoked), and starts, renews and signs out of it. An agent's `jelly_connection_request`, or a tool
result that names this plugin's "Run /connect and choose …" next step, opens the same card. The plugin still signs in
through OpenCode, as it does without Jelly; the declaration only tells Jelly which of the engine's integrations and
servers are this plugin's.

## Versions

Jelly's curated catalogue pins an exact version, so publish each release under a new version: a review in Jelly can then
tell the two apart.
