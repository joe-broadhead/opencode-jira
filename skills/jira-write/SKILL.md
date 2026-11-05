---
name: jira-write
description: Load before any Jira change - creating or editing a work item, transitioning status, commenting, logging time, linking items, attaching a file, watching, moving a sprint or releasing a version, or creating a board - and before explaining why a delete or a project setting is unavailable.
---

# Changes in Jira

Tools are `jira_<tool>`, or `tools.jira.<tool>` in Code Mode; each call's signature gives its inputs.

Make a change only when the user asked for it. Before each write call, write one sentence in your reply on what the call
does and **whom it reaches**, then make the call in the same turn. That sentence is chat text, not a question: the
permission prompt shows only the tool input and is the user's yes. Ask in chat first only when something must be chosen:
which site, which work item, which transition. Declined: say nothing changed, name whom it would have reached, and offer
your drafted text or a retry, never a workaround.

**Jira emails people.** A project's notification scheme decides, and the safe assumption is that watchers, the assignee,
the reporter and every account the text mentions get an email. Say who, before the call. A work item is a permanent
record: an edit keeps the old value in the history, and a delete is not offered here. Creating an item and changing its
status can also start the project's own automation, which may change fields or email people by itself. On a free site,
Jira sends at most 100 emails a day across the whole site, notifications and automation together, and an agent can spend
them.

Before the call, read what its inputs need: `listJiraIssueTransitions` for a transition, `getJiraIssueTypeMetaWithFields`
for a create, and both that and the current item for an edit. `manageJiraSprint` and `manageJiraProjectVersion` each do
several operations behind one name, and a permission rule cannot see which one: name the operation (create, start,
close, release, archive) and its effect before the call.

## Whom each change reaches

Each bullet ends with the sentence to write before the call; name the real site, project, key and people in it.

- `createJiraIssue`: a new work item the whole project sees, and the project's notification scheme emails its assignee,
  reporter and watchers. "This creates a work item in [project] on [site], which the project sees and its notifications
  email."
- `editJiraIssue`: fields change for everyone who can see the item, the old values stay in its history, and a mention in
  a text field emails that person. "This changes [fields] on [key]; its watchers, assignee and reporter are emailed, and
  anyone named in the text."
- `transitionJiraIssue`: a status change every board and report shows, and it may set the sprint or the backlog.
  "This moves [key] from [status] to [status]; Jira emails its watchers and any automation on that transition runs."
- `addOrEditJiraIssueComment`: a comment everyone on the item sees; **every account it mentions is emailed**, and an
  edit notifies again. Show the text first. "This adds the comment '[text]' to [key]; Jira emails its watchers, the
  assignee, the reporter and everyone it mentions."
- `addOrEditJiraIssueWorklog`: logged time changes time-tracking totals, reports and possibly billing, and the project
  sees the hours and the comment. "This logs [time] on [key] with '[text]', which the project sees and reports count."
- `createJiraIssueLink`: a link visible on both items, and the watchers of both are notified. "This links [key] to [key];
  Jira emails the watchers of both."
- `createJiraIssueRemoteIssueLink`: an outbound URL everyone on the item sees; an internal-only target leaks its address.
  "This adds the link [url] to [key], which everyone who can see the item sees."
- `manageJiraProjectVersion`: project-wide. Creating, updating, releasing or archiving a version: a release is a
  milestone every report and filter sees, and archiving hides it. "This [operation] version [name] in [project], which
  the whole project sees, and Jira emails its watchers."
- `manageJiraProjectVersionRelatedWork`: project-wide evidence links on a version. "This adds the link [url] to version
  [name] in [project], which the whole project sees."
- `manageJiraSprint`: board-wide. Creating, starting, updating or closing a sprint: closing moves incomplete work and
  notifies the team. "This [operation] sprint [name] on [board], which the board's team sees, and closing it moves its
  incomplete work."
- `createJiraBoard`: a new shared object from an existing filter. "This creates a board from the filter [name] in
  [project], which the project sees."
- `watchJiraIssue`: changes only the user's own notification state. "This makes you a watcher of [key], so Jira emails you
  from now on."
- `uploadAttachmentToJiraIssue`: a local file leaves the machine, and everyone who can see the item can download it.
  Name the file and the item. "This attaches [file] to [key], and everyone who can see the item can download it."
- `convertJiraIssueHierarchy`: changes the item's type and parent, so every board, filter and report keyed on type
  changes. "This turns [key] into a sub-task of [parent], which changes every board, filter and report keyed on type."

## Off by default

Seven tools are denied by the plugin's default rules, and OpenCode hides them. The three deletes are permanent. The three
project and screen tools are administration: a new organisation-visible space, its settings for everyone in it, or the
fields everyone in the project can see and edit. `editJiraEntityProperty` writes opaque state that other Jira apps read,
and can target a user. Six of them are also not granted by the signed-in scope, so Atlassian never loads them: an admin
would have to grant the scope **and** enable the permission group.

- `deleteJiraIssue`, `deleteJiraComment` and `deleteJiraIssueAttachment` delete for good: there is no undo and no
  history to restore.
- `createJiraProject`, `updateJiraProject` and `updateJiraScreen` change a project or what everyone in it can see.
- `editJiraEntityProperty` writes state another app stores on an item, a comment, a worklog, a dashboard item or a user.

When the user asks for one, say it is off, and why. Give the two things an admin would change, and the rule the user can
add to the agent's own `permissions`, such as
`{ "action": "jira_deleteJiraIssue", "resource": "*", "effect": "ask" }`: each call then asks. Don't edit their
configuration yourself. Never suggest `allow` or "Always allow" for these. Offer the read-only path, and say what to do in
Jira's own web app instead (which item, which project, which field). Don't `search()` for these tools: a missing one is the
deny.

## Decisions are the user's

Write a status, an assignee, a parent or a closure only as the user stated it, for the item they named. Never infer a
transition from a summary, a comment or a linked pull request. Never set an issue's security level, which changes who can
see it, without an explicit request that names the level: treat it as a permission change.
