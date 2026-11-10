# Jira for OpenCode

Find and read your Jira work items, boards and sprints from OpenCode, and make selected changes, through Atlassian's
official MCP server.

Every tool is allowed by default. A change, a delete or an attachment download runs without a prompt unless you
restrict it, and [Permissions](#permissions) shows the one option that does.

Unofficial; not affiliated with Atlassian.

## Requirements

- OpenCode `>=2.2.3 <2.3.0`, tested on 2.2.3, 2.2.4, 2.2.5 and 2.2.6. Outside that range the plugin does not start, unless
  you set `allowUntestedHost`.
- macOS or Linux, and a browser for the sign-in.
- A Jira Cloud site on a plan whose Atlassian Administration allows the Atlassian MCP server.
- An organisation admin who allows **Read**, **Search** and **Write** for Atlassian MCP in Atlassian Administration,
  Connectors, Atlassian MCP server, Permissions.
- Your own Jira permissions decide what you can see and change. A site admin can also block access by IP address.
- The tools are Atlassian's, and Atlassian may change them without notice. A tool Atlassian adds is allowed at once
  under `access: "all"`, and is counted as unknown until a release knows it.
- The 33 read, 1 export, 14 write and 7 destructive tools, and their classes, come from Atlassian's own published tool
  list, which gives no annotations: treat a class as Atlassian's description of the tool, not as its annotation.

## Install

```sh
opencode plugin add github:joe-broadhead/opencode-jira#v0.0.0
```

Run `opencode reload`, or restart OpenCode. Then run `/jira-status`: it shows `sign-in required` until you sign in
(see [Sign in](#sign-in)).

Each release has its own tag, and a Git install does not update by itself. To move to a newer release, remove the old entry with `opencode plugin remove github:joe-broadhead/opencode-jira#v0.0.0`, then add the new tag with `opencode plugin add github:joe-broadhead/opencode-jira#v<version>`.

Or add the plugin to `opencode.json` instead, with the same spec:

```json
{ "plugins": [{ "package": "github:joe-broadhead/opencode-jira#v0.0.0" }] }
```

The plugin registers Atlassian's MCP server under the name `jira`, adds default permission rules, the `/jira-status`
command, the `/jira` status view and two skills. Every tool is Atlassian's, and OpenCode handles the connection, the
sign-in and the stored credentials.

The install takes the GitHub release tag. Its commit carries the built `dist/`, so the install runs no build.
A new release is a new tag: install it with its own `#v<version>` spec.

## Sign in

Run `/connect` and choose **Jira** (it is listed under MCP). In the terminal UI, press `o` or Enter to open the link
to Atlassian's sign-in page in your browser, sign in, and approve the access. No API token is needed or used.

From a terminal, run `opencode mcp auth jira` instead. Run it from the project folder where the plugin is installed; if
it answers `MCP server not found: jira`, OpenCode is still opening that folder: wait a few seconds and run it again.
`/mcps` also offers the same sign-in.

The plugin pins the access it asks for: Jira read, write and search, plus your account name and an offline token. It does
not ask for delete, for project or screen administration, or for Confluence, and because the request is pinned,
Atlassian cannot grant more than that: it then does not load those tools at all.

One sign-in may reach **several sites**. Every call names a site, and the model asks which one, once per session, when
you belong to more than one, then names it before every change.

When the sign-in expires and cannot be renewed, `/connect` marks the Jira account as needing a new sign-in, and
OpenCode shows its "MCP server needs authentication" notice.

To sign out, or to switch account: Run it from the project folder where the plugin is installed, or remove the account in `/connect` → **Jira**. If it answers `MCP server not found: jira`, OpenCode is still opening that folder: wait a few seconds and run it again. Then sign in again. To sign out before you remove the plugin, see
[Uninstall](#uninstall).

## Use

Ask, for example:

- "What's the status of PROJ-123?"
- "My open items in PROJ."
- "What moved to In Review this week?"
- "How many are in progress on the board?"
- "Log 30 minutes on PROJ-42."
- "Comment that the PR is up and mention Sam."
- "Create three items from these notes."

Every change can email people, so the model says whom it reaches before it makes the call.

| Command | What it does |
| --- | --- |
| `/jira-status` | Posts the status report into the session: connection, account, access, sites, tools, agents without the default rules, the OpenCode check and the next step. The model can read it too. |
| `/jira`, or "Jira: Status" in the command palette | Opens the same report in a dialog. Press `r` to refresh it and `Esc` to close it. It also refreshes when Jira's connection, the sign-in or the agents change. |

The Account and Sites rows come from your own first calls in a session (`atlassianUserInfo` and
`getAccessibleAtlassianResources`). The plugin makes no Atlassian call of its own, and shows a display name and site
names only: never an email address, an account id or a cloud id.

Two skills teach the model to use Jira well:

- `jira`: finding a work item, JQL, boards, sprints, versions, filters, attachments, choosing the site, and the rules
  for other people's words and data.
- `jira-write`: whom each change reaches, saying so before the call, naming the operation for the sprint and version
  tools, and leaving the yes to OpenCode's permission prompt.

### Scripts

A script or a cron job can call every known Jira tool with no model, through `opencode api`. It runs as a session and
its agent, under that agent's permission rules and the session's own, and gets the same default: every method runs
unless the agent restricts. A session on an agent with `access: "ask-changes"` or `read-only` needs an explicit `allow`
for the method in the session's or the agent's rules. An `ask` is refused before anything reaches Atlassian, and a
saved "Always allow" does not authorise a script.

```sh
opencode api post /api/rpc/jira.issues.tools/getAccessibleAtlassianResources \
  -H "x-opencode-directory:$PWD" \
  -d '{"input":{"sessionID":"ses_…","input":{}}}'
```

`describe` lists every method with its class and each tool's input schema, and — given a session — each method's
permission; every Jira call needs a `cloudId` from `getAccessibleAtlassianResources`.

See [Scripting](https://github.com/joe-broadhead/opencode-jira/blob/HEAD/docs/scripting.md).

## Permissions

**Every tool is allowed by default.** The plugin adds one block to every agent, right after the agent's base rule that
allows everything, and that block allows Jira's tools: reads, writes, deletes, project settings and attachment
downloads alike. An agent can therefore create or edit a work item, transition it, comment, or mint a signed
attachment URL without a prompt. `/jira` and `/jira-status` show the block, the access value and the tools involved.

There are three ways to restrict it.

### 1. The `access` option

```json
{
  "plugins": [
    { "package": "github:joe-broadhead/opencode-jira#v0.0.0", "options": { "access": "ask-changes" } }
  ]
}
```

| `access` | What runs |
| --- | --- |
| `all` (the default) | every Jira tool runs without a prompt |
| `ask-changes` | a read runs; every other tool asks, including one Atlassian adds later |
| `read-only` | a read runs; every other tool is denied, and hidden from the model |

The block is generated from the tool table and the value, so `/jira` always shows what is in force. The three
blocks:

#### `all` (the default)

The plugin adds these rules for `access: "all"`:

```json
[
    { "action": "jira_*", "resource": "*", "effect": "allow" },
    { "action": "jira_atlassianUserInfo", "resource": "*", "effect": "allow" },
    { "action": "jira_getAccessibleAtlassianResources", "resource": "*", "effect": "allow" },
    { "action": "jira_getContentFormatGuide", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraBoardConfig", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraBoardIssueData", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraBoardSprintData", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraCurrentUser", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraEntityProperty", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraIssue", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraIssueTypeMetaWithFields", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraProjectVersionRelatedWork", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraProjectVersions", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraScreen", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraUser", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraWorkflowEditorLink", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraWorkflows", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraBoardSprints", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraBoards", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraDashboards", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraFilters", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraIssueAssignableUsers", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraIssueChangelogs", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraIssueComments", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraIssueLinkTypes", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraIssueRemoteIssueLinks", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraIssueTransitions", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraIssueWorklogs", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraProjectComponents", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraProjectIssueTypesMetadata", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraProjects", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraStatuses", "resource": "*", "effect": "allow" },
    { "action": "jira_lookupJiraAccountId", "resource": "*", "effect": "allow" },
    { "action": "jira_searchJiraIssuesUsingJql", "resource": "*", "effect": "allow" },
    { "action": "jira_downloadJiraIssueAttachment", "resource": "*", "effect": "allow" },
    { "action": "jira_addOrEditJiraIssueComment", "resource": "*", "effect": "allow" },
    { "action": "jira_addOrEditJiraIssueWorklog", "resource": "*", "effect": "allow" },
    { "action": "jira_convertJiraIssueHierarchy", "resource": "*", "effect": "allow" },
    { "action": "jira_createJiraBoard", "resource": "*", "effect": "allow" },
    { "action": "jira_createJiraIssue", "resource": "*", "effect": "allow" },
    { "action": "jira_createJiraIssueLink", "resource": "*", "effect": "allow" },
    { "action": "jira_createJiraIssueRemoteIssueLink", "resource": "*", "effect": "allow" },
    { "action": "jira_editJiraIssue", "resource": "*", "effect": "allow" },
    { "action": "jira_manageJiraProjectVersion", "resource": "*", "effect": "allow" },
    { "action": "jira_manageJiraProjectVersionRelatedWork", "resource": "*", "effect": "allow" },
    { "action": "jira_manageJiraSprint", "resource": "*", "effect": "allow" },
    { "action": "jira_transitionJiraIssue", "resource": "*", "effect": "allow" },
    { "action": "jira_uploadAttachmentToJiraIssue", "resource": "*", "effect": "allow" },
    { "action": "jira_watchJiraIssue", "resource": "*", "effect": "allow" },
    { "action": "jira_createJiraProject", "resource": "*", "effect": "allow" },
    { "action": "jira_deleteJiraComment", "resource": "*", "effect": "allow" },
    { "action": "jira_deleteJiraIssue", "resource": "*", "effect": "allow" },
    { "action": "jira_deleteJiraIssueAttachment", "resource": "*", "effect": "allow" },
    { "action": "jira_editJiraEntityProperty", "resource": "*", "effect": "allow" },
    { "action": "jira_updateJiraProject", "resource": "*", "effect": "allow" },
    { "action": "jira_updateJiraScreen", "resource": "*", "effect": "allow" }
]
```

#### `ask-changes`

The plugin adds these rules for `access: "ask-changes"`:

```json
[
    { "action": "jira_*", "resource": "*", "effect": "ask" },
    { "action": "jira_atlassianUserInfo", "resource": "*", "effect": "allow" },
    { "action": "jira_getAccessibleAtlassianResources", "resource": "*", "effect": "allow" },
    { "action": "jira_getContentFormatGuide", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraBoardConfig", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraBoardIssueData", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraBoardSprintData", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraCurrentUser", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraEntityProperty", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraIssue", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraIssueTypeMetaWithFields", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraProjectVersionRelatedWork", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraProjectVersions", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraScreen", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraUser", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraWorkflowEditorLink", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraWorkflows", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraBoardSprints", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraBoards", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraDashboards", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraFilters", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraIssueAssignableUsers", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraIssueChangelogs", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraIssueComments", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraIssueLinkTypes", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraIssueRemoteIssueLinks", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraIssueTransitions", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraIssueWorklogs", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraProjectComponents", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraProjectIssueTypesMetadata", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraProjects", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraStatuses", "resource": "*", "effect": "allow" },
    { "action": "jira_lookupJiraAccountId", "resource": "*", "effect": "allow" },
    { "action": "jira_searchJiraIssuesUsingJql", "resource": "*", "effect": "allow" },
    { "action": "jira_downloadJiraIssueAttachment", "resource": "*", "effect": "ask" },
    { "action": "jira_addOrEditJiraIssueComment", "resource": "*", "effect": "ask" },
    { "action": "jira_addOrEditJiraIssueWorklog", "resource": "*", "effect": "ask" },
    { "action": "jira_convertJiraIssueHierarchy", "resource": "*", "effect": "ask" },
    { "action": "jira_createJiraBoard", "resource": "*", "effect": "ask" },
    { "action": "jira_createJiraIssue", "resource": "*", "effect": "ask" },
    { "action": "jira_createJiraIssueLink", "resource": "*", "effect": "ask" },
    { "action": "jira_createJiraIssueRemoteIssueLink", "resource": "*", "effect": "ask" },
    { "action": "jira_editJiraIssue", "resource": "*", "effect": "ask" },
    { "action": "jira_manageJiraProjectVersion", "resource": "*", "effect": "ask" },
    { "action": "jira_manageJiraProjectVersionRelatedWork", "resource": "*", "effect": "ask" },
    { "action": "jira_manageJiraSprint", "resource": "*", "effect": "ask" },
    { "action": "jira_transitionJiraIssue", "resource": "*", "effect": "ask" },
    { "action": "jira_uploadAttachmentToJiraIssue", "resource": "*", "effect": "ask" },
    { "action": "jira_watchJiraIssue", "resource": "*", "effect": "ask" },
    { "action": "jira_createJiraProject", "resource": "*", "effect": "ask" },
    { "action": "jira_deleteJiraComment", "resource": "*", "effect": "ask" },
    { "action": "jira_deleteJiraIssue", "resource": "*", "effect": "ask" },
    { "action": "jira_deleteJiraIssueAttachment", "resource": "*", "effect": "ask" },
    { "action": "jira_editJiraEntityProperty", "resource": "*", "effect": "ask" },
    { "action": "jira_updateJiraProject", "resource": "*", "effect": "ask" },
    { "action": "jira_updateJiraScreen", "resource": "*", "effect": "ask" }
]
```

#### `read-only`

The plugin adds these rules for `access: "read-only"`:

```json
[
    { "action": "jira_*", "resource": "*", "effect": "deny" },
    { "action": "jira_atlassianUserInfo", "resource": "*", "effect": "allow" },
    { "action": "jira_getAccessibleAtlassianResources", "resource": "*", "effect": "allow" },
    { "action": "jira_getContentFormatGuide", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraBoardConfig", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraBoardIssueData", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraBoardSprintData", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraCurrentUser", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraEntityProperty", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraIssue", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraIssueTypeMetaWithFields", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraProjectVersionRelatedWork", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraProjectVersions", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraScreen", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraUser", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraWorkflowEditorLink", "resource": "*", "effect": "allow" },
    { "action": "jira_getJiraWorkflows", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraBoardSprints", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraBoards", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraDashboards", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraFilters", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraIssueAssignableUsers", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraIssueChangelogs", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraIssueComments", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraIssueLinkTypes", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraIssueRemoteIssueLinks", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraIssueTransitions", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraIssueWorklogs", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraProjectComponents", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraProjectIssueTypesMetadata", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraProjects", "resource": "*", "effect": "allow" },
    { "action": "jira_listJiraStatuses", "resource": "*", "effect": "allow" },
    { "action": "jira_lookupJiraAccountId", "resource": "*", "effect": "allow" },
    { "action": "jira_searchJiraIssuesUsingJql", "resource": "*", "effect": "allow" },
    { "action": "jira_downloadJiraIssueAttachment", "resource": "*", "effect": "deny" },
    { "action": "jira_addOrEditJiraIssueComment", "resource": "*", "effect": "deny" },
    { "action": "jira_addOrEditJiraIssueWorklog", "resource": "*", "effect": "deny" },
    { "action": "jira_convertJiraIssueHierarchy", "resource": "*", "effect": "deny" },
    { "action": "jira_createJiraBoard", "resource": "*", "effect": "deny" },
    { "action": "jira_createJiraIssue", "resource": "*", "effect": "deny" },
    { "action": "jira_createJiraIssueLink", "resource": "*", "effect": "deny" },
    { "action": "jira_createJiraIssueRemoteIssueLink", "resource": "*", "effect": "deny" },
    { "action": "jira_editJiraIssue", "resource": "*", "effect": "deny" },
    { "action": "jira_manageJiraProjectVersion", "resource": "*", "effect": "deny" },
    { "action": "jira_manageJiraProjectVersionRelatedWork", "resource": "*", "effect": "deny" },
    { "action": "jira_manageJiraSprint", "resource": "*", "effect": "deny" },
    { "action": "jira_transitionJiraIssue", "resource": "*", "effect": "deny" },
    { "action": "jira_uploadAttachmentToJiraIssue", "resource": "*", "effect": "deny" },
    { "action": "jira_watchJiraIssue", "resource": "*", "effect": "deny" },
    { "action": "jira_createJiraProject", "resource": "*", "effect": "deny" },
    { "action": "jira_deleteJiraComment", "resource": "*", "effect": "deny" },
    { "action": "jira_deleteJiraIssue", "resource": "*", "effect": "deny" },
    { "action": "jira_deleteJiraIssueAttachment", "resource": "*", "effect": "deny" },
    { "action": "jira_editJiraEntityProperty", "resource": "*", "effect": "deny" },
    { "action": "jira_updateJiraProject", "resource": "*", "effect": "deny" },
    { "action": "jira_updateJiraScreen", "resource": "*", "effect": "deny" }
]
```

Three of the reads, `jira_getJiraScreen`, `jira_getJiraWorkflowEditorLink` and `jira_getJiraWorkflows`, sit in
Atlassian's `manage_jira` group, which this plugin does not request, so they never arrive. They stay allowed in the
block; Atlassian simply does not list them.

### 2. An agent's own rules

A rule in an agent's own `permissions` comes after the plugin's block, so it wins for that agent. A read-only agent
that keeps Jira's reads and asks for one change:

```json
{
  "agents": {
    "build": {
      "permissions": [
        { "action": "jira_*", "resource": "*", "effect": "ask" },
        { "action": "jira_getJiraIssue", "resource": "*", "effect": "allow" },
        { "action": "jira_searchJiraIssuesUsingJql", "resource": "*", "effect": "allow" },
        { "action": "jira_transitionJiraIssue", "resource": "*", "effect": "ask" }
      ]
    }
  }
}
```

### 3. A per-tool rule

Every action is `jira_` followed by the tool's name. A later rule wins, so this denies one tool in the top-level
`permissions`, for every agent:

```json
{
  "permissions": [
    { "action": "jira_deleteJiraIssue", "resource": "*", "effect": "deny" }
  ]
}
```

`jira_deleteJiraIssue`, `jira_deleteJiraComment` and `jira_deleteJiraIssueAttachment` delete permanently, with no
history to restore. `jira_createJiraProject`, `jira_updateJiraProject` and `jira_updateJiraScreen` are administration:
a new organisation-visible container, its settings for everyone in it, or the fields everyone in the project can see
and edit. `jira_editJiraEntityProperty` writes opaque state that other Jira apps and integrations read, and can target
a user.

The first six are also **not granted by the sign-in's scope**, which this plugin pins, so Atlassian never loads them
and no admin action can change that: a new release of this plugin would have to request the scope, and an admin would
have to enable the permission group. The exception is `jira_editJiraEntityProperty`, which the grant covers: the deny
above is the lock that keeps it off.

### What each change reaches

Say what a change does and whom it reaches before you make it. Every change can email people: a project's notification
scheme decides, and the safe assumption is that watchers, the assignee, the reporter and everyone mentioned get an
email.

- `jira_transitionJiraIssue`: moves a work item to another status. Any post-function the transition carries runs, so
  fields can change, and its notifications go out.
- `jira_createJiraIssue`: a new work item that the project's members see.
- `jira_addOrEditJiraIssueComment`: a comment, or an edit to one, that everyone watching the item is emailed about.
- `jira_editJiraIssue`: field changes on the item, with its notifications.
- `jira_watchJiraIssue` emails only you, and only from then on.

On a free site, Jira sends at most 100 emails a day across the whole site, notifications and automation together, and
an agent can spend them.

`jira_downloadJiraIssueAttachment` is the export class, not a read: it mints a short-lived signed URL and a curl
command, which is a file credential. With `access: "all"` it runs; `ask-changes` asks for each call and `read-only`
denies it. Its output belongs in your chat only.

Everything that comes later than these rules still wins: an agent's own stricter rules (Explore cannot use Jira), your
`permissions` in `opencode.json`, and your saved "Always allow" answers. In an unattended run such as `opencode run`, a
tool that asks is refused.

Agents that exist only in your own config, and agents added by plugins that load later, are created after the plugin
adds its rules, so they get no block. With `access: "all"` that changes nothing; with `ask-changes` or `read-only` they
stay unrestricted, and `/jira-status` and `/jira` name them with the block to put first in each one's own
`permissions`. Do not put an `ask` or an `allow` in the top-level `permissions`, which would reach every agent,
Explore included.
[Configuration](https://github.com/joe-broadhead/opencode-jira/blob/HEAD/docs/configuration.md#permissions) has a
worked example and permission recipes.

## Configure

Set options with the object form of the plugin entry:

```json
{
  "plugins": [{ "package": "github:joe-broadhead/opencode-jira#v0.0.0", "options": { "allowUntestedHost": true } }]
}
```

| Option | Values | Default | Effect |
| --- | --- | --- | --- |
| `access` | `"all"`, `"ask-changes"` or `"read-only"` | `"all"` | How much the default rules restrict; see [Permissions](#permissions). |
| `allowUntestedHost` | `true` or `false` | `false` | Starts on an OpenCode version outside `>=2.2.3 <2.3.0`, with a warning in status. |

[docs/configuration.md](https://github.com/joe-broadhead/opencode-jira/blob/HEAD/docs/configuration.md) has the
details, including your own `mcp.servers.jira` entry, an API-token entry for a headless machine, permission recipes and
every error.

## Organisation rollout

OpenCode registers itself with Atlassian's sign-in server on first use, so there is no client ID to distribute. Put the
plugin entry in the system config: `/Library/Application Support/opencode/opencode.json` on macOS, or
`/etc/opencode/opencode.json` on Linux. This example also turns off creating work items, for everyone:

```json
{
  "plugins": [{ "package": "github:joe-broadhead/opencode-jira#v0.0.0" }],
  "permissions": [{ "action": "jira_createJiraIssue", "resource": "*", "effect": "deny" }]
}
```

The delete and project-setting tools cannot run through this plugin even with `access: "all"`: it pins a request
without the delete or manage scope, so Atlassian never loads them, and only a new release of the plugin can change
that. An admin's permission group and the user's own `deny` rule are the two locks after it, as
[Permissions](#permissions) shows.

Members then only sign in: run `/connect` and choose Jira, then press `o` or Enter to open the link. Atlassian's own
controls stay in Atlassian Administration: the **Connectors** permissions, the domain allowlist (which permits
loopback addresses by default, so OpenCode needs no addition), the API-token switch, and IP allowlists.
Leaving "Allow Atlassian supported domains" on keeps the local sign-in working.

## Troubleshooting

Run `/jira-status` first. Its last line is the next step.

| Status or error | What to do |
| --- | --- |
| Connection: sign-in required | Run `/connect` and choose Jira, then press `o` or Enter to open the link. In a terminal, `opencode mcp auth jira` opens it automatically: run it from the project folder, and if it answers `MCP server not found: jira`, wait a few seconds and run it again. |
| Connection: connecting | Wait a few seconds, then run `/jira-status` again. |
| Connection: failed | Check your network, then run `/jira-status` again. With your own `mcp.servers.jira` that has `"oauth": false`, check the API token in its headers. |
| Connection: disabled | Enable `jira` in `/mcps`, or remove `"disabled": true` from `mcp.servers.jira` in `opencode.json`. |
| Connection: not configured | An organisation policy (`mcp.use`) or another plugin removes the `jira` server. Ask your administrator, then restart OpenCode. |
| Connection: conflict | Your config has an `mcp.servers.jira` entry with a URL other than `https://mcp.atlassian.com/v2/mcp?tools=all`. A plain `/v2/mcp` is the meta-tool server, not this one. Point it at the plugin's URL or remove it, then restart OpenCode. |
| The browser comes back to a blank page or a connection error | Atlassian did not accept the loopback callback on its port. Set `oauth.redirect_uri` in `mcp.servers.jira`, which registers that exact callback instead; see [Configuration](https://github.com/joe-broadhead/opencode-jira/blob/HEAD/docs/configuration.md#your-own-mcpserversjira). |
| Access denied after signing in | An organisation's domain allowlist refuses the client origin, or its IP allowlist refuses this machine. Ask an organisation admin. |
| `You don't have permission to connect from this IP address` | The site's IP allowlist. Ask a site admin to allow this network. |
| Tools: none listed yet | Jira connected moments ago and is still listing its tools. Run `/jira-status` again, or press `r` in the dialog, in a few seconds. |
| Tools: 0 available | An organisation admin has not allowed Read and Search for Atlassian MCP. See [Requirements](#requirements). |
| Tools: not granted by scope | The three workflow and screen reads sit in Atlassian's `manage_jira` group, which this plugin does not request. Nothing is wrong, and they cannot be turned on without a scope change. |
| Tools: allowed like everything else, ask or denied | The listed tools are the destructive class. What happens to them follows the `access` value. See [Permissions](#permissions). |
| Tools: unknown | Atlassian added tools the plugin does not know yet. Under `access: "all"` they run at once, `ask-changes` asks, and `read-only` denies them. A known tool missing from the count is normal: Atlassian lists only the tools a grant covers. |
| Access: default rules missing or not added | Some agents lack the default rules (see the agents row), or OpenCode could not add them (see the OpenCode row). Follow the next step. |
| Account or Sites: not read yet | Nothing is wrong: the plugin learns both from your own calls. Make one Jira request in the session, then run `/jira-status` again. |
| A change is refused with no permission | Either the `access` value denies it, or this plugin's pinned request has no delete or manage scope, so Atlassian never loads those tools. A later rule of your own can allow the first; a new release must request the scope for the second. |
| Sign-in succeeded but calls fail | The site is wrong, or the token was consented for another site. Sign out and in again (see [Sign in](#sign-in)) from the project folder, and name the site. |
| Rate limited | Atlassian publishes `Retry-After` and `X-RateLimit-*`. Wait the seconds it names, and make fewer calls at once. |
| The site's email stopped | A free site sends at most 100 notification emails a day, automation included, and an agent can spend them. |
| Agents without default rules | Put the default rules shown by `/jira-status` first in each listed agent's own permissions, in `opencode.json` or the agent's Markdown file, followed by your top-level rules for Jira tools. |
| OpenCode: untested | OpenCode is not 2.2.3, 2.2.4, 2.2.5 or 2.2.6. Inside `>=2.2.3 <2.3.0` the plugin runs normally; outside it, it runs only because `allowUntestedHost` is set. If Jira misbehaves, use a tested release. |
| Signed in to the wrong Atlassian account | Remove the account in `/connect` → Jira, or run `opencode mcp logout jira` from the project folder; if it answers `MCP server not found: jira`, wait a few seconds and run it again. Then sign in again. |
| Asked to sign in again after the token expires | The sign-in could not be renewed. Sign in again with `/connect` → Jira; your Atlassian session may still be open in the browser. |
| A Jira tool is refused in `opencode run` | Nobody could answer its prompt. Add an `allow` rule for that tool to the agent's own `permissions`, or use `access: "all"`. |
| A skill seems ignored, and status names a skill to rename or move | A skill of yours with the same id, such as `jira`, replaces the plugin's. Rename or move it. |
| `/jira` is missing | The plugin did not start. Run `/plugins` to see the error. |

## Errors

Every error reads `CODE: What happened. Next step: What to do.` The codes are the plugin's own one table. `setup` and
`status` codes come from the plugin; `rpc` codes are a refusal from the tools RPC for scripts, which
[Scripting](https://github.com/joe-broadhead/opencode-jira/blob/HEAD/docs/scripting.md#errors) explains in detail.

| Code | Surface | When |
| --- | --- | --- |
| `HOST_UNTESTED` | setup | OpenCode is outside the supported range and `allowUntestedHost` is not set. |
| `OPTIONS_INVALID` | setup | An option is unknown or has a wrong value. |
| `SKILLS_INVALID` | setup | A skill file is missing or broken; the plugin still starts. |
| `SERVER_NOT_REGISTERED` | setup | The `jira` server could not be registered. |
| `RULES_NOT_ADDED` | setup | The default permission rules could not be added. |
| `STATUS_UNAVAILABLE` | status | The status could not be read, or the plugin is not running. |
| `SESSION_UNKNOWN` | rpc | The session does not exist in this location. |
| `SESSION_AGENT_REQUIRED` | rpc | The session names no agent, or one that does not exist. |
| `PERMISSION_DENIED` | rpc | The last matching rule is an `ask` or a `deny`; refused before dispatch. |
| `SERVER_CONFLICT` | rpc | `mcp.servers.jira` is defined at another URL. |
| `AUTH_REQUIRED` | rpc | The `jira` server needs a sign-in. |
| `CONNECTING` | rpc | The `jira` server is still connecting. |
| `CONNECTION_FAILED` | rpc | The `jira` server could not connect. |
| `DISABLED` | rpc | The `jira` server is disabled. |
| `NOT_REGISTERED` | rpc | The `jira` server is not registered. |
| `TOOL_UNAVAILABLE` | rpc | The server is connected but OpenCode does not list the tool. |
| `UPSTREAM_ERROR` | rpc | Atlassian answered with an error, such as an invalid input or a rate limit. |
| `CANCELLED` | rpc | The request was cancelled. |

The status RPC's own error is `unavailable`, with a next step, when the status cannot be read.

## Known limits

- **The tool table comes from Atlassian's docs.** Atlassian publishes no annotations, so a class is a judgement from
  Atlassian's description of the tool. A tool Atlassian adds is allowed at once and counted as unknown; a tool
  Atlassian marks as changing data could run here as a read until a release knows it. The table has not been checked
  against a signed-in server's tool list yet: `npm run drift` compares a saved list with it, and `CONTRIBUTING.md` has the steps.
- **A script's read can cross projects.** A script's session may belong to another directory than the OpenCode server
  answering it, and the read then runs under the serving location's agent rules; only a `deny` is refused in between.
  Run scripts in the project whose agent you mean. This is in the module shared with the other plugins, not in this
  one.
- **In Jelly, a tool Atlassian adds is not asked about.** Jelly applies each declared tool's effect and nothing else,
  so an undeclared tool, a write included, runs with the plugin's own default. A Jelly admin can set it to ask.

- Updates are not automatic for a Git install, and `opencode plugin update` and `opencode plugin check` do not work on one: to move to a newer release, remove the old entry and add the new tag.

## Uninstall

Sign out while the plugin is still installed: once it is removed, OpenCode no longer knows the `jira` server and the
sign-in stays in OpenCode's credential store.

1. Sign out: remove the account in `/connect` → **Jira**, or run `opencode mcp logout jira` from the project folder
   where the plugin is installed. If it answers `MCP server not found: jira`, OpenCode is still opening that folder:
   wait a few seconds and run it again.
2. Check: `opencode auth list` no longer lists **Jira**.
3. Remove the plugin: `opencode plugin remove github:joe-broadhead/opencode-jira#v0.0.0`, then `opencode reload`.
   `opencode mcp list` no longer lists `jira`.
4. Remove any Jira rules you copied into your agents' own `permissions`.

An organisation admin can also turn Atlassian MCP off for the whole organisation.

## Links

- [Configuration](https://github.com/joe-broadhead/opencode-jira/blob/HEAD/docs/configuration.md)
- [Scripting](https://github.com/joe-broadhead/opencode-jira/blob/HEAD/docs/scripting.md)
- [In Jelly](https://github.com/joe-broadhead/opencode-jira/blob/HEAD/docs/jelly.md)
- [Architecture](https://github.com/joe-broadhead/opencode-jira/blob/HEAD/docs/architecture.md)
- [Contributing](https://github.com/joe-broadhead/opencode-jira/blob/HEAD/CONTRIBUTING.md)
- [Security](https://github.com/joe-broadhead/opencode-jira/blob/HEAD/SECURITY.md)
- [Changelog](https://github.com/joe-broadhead/opencode-jira/blob/HEAD/CHANGELOG.md)
- [MIT license](https://github.com/joe-broadhead/opencode-jira/blob/HEAD/LICENSE)
- [Atlassian's supported tools](https://support.atlassian.com/atlassian-ai-gateway/docs/supported-tools/)
