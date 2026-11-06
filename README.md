# Jira for OpenCode

Find and read your Jira work items, boards and sprints from OpenCode, and make selected changes, through Atlassian's
official MCP server.

Unofficial; not affiliated with Atlassian.

## Requirements

- OpenCode `>=2.2.3 <2.3.0`, tested on 2.2.3, 2.2.4 and 2.2.5. Outside that range the plugin does not start, unless
  you set `allowUntestedHost`.
- macOS or Linux, and a browser for the sign-in.
- A Jira Cloud site on a plan whose Atlassian Administration allows the Atlassian MCP server.
- An organisation admin who allows **Read** and **Search** for Atlassian MCP in Atlassian Administration, Connectors,
  Atlassian MCP server, Permissions, and **Write** for any change.
- Your own Jira permissions decide what you can see and change. A site admin can also block access by IP address.
- The tools are Atlassian's, and Atlassian may change them without notice. A tool Atlassian adds asks before it runs
  until a release of this plugin knows it.
- The tools, and which of them read and write, are Atlassian's.

## Install

```sh
opencode plugin add @joe-broadhead/opencode-jira
```

Run `opencode reload`, or restart OpenCode. Then run `/jira-status`: it shows `sign-in required` until you sign in
(see [Sign in](#sign-in)).

The plugin registers Atlassian's MCP server under the name `jira`, adds default permission rules, the `/jira-status`
command, the `/jira` status view and two skills. Every tool is Atlassian's, and OpenCode handles the connection, the
sign-in and the stored credentials.

**Update** with `opencode plugin update @joe-broadhead/opencode-jira`, then run `opencode reload`. An entry pinned to a
version does not update: remove the `@version` from its `plugins` entry first.

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
| `/jira-status` | Posts the status report into the session: connection, account, sites, access, tools, agents without the default rules, the OpenCode check and the next step. The model can read it too. |
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

A script or a cron job can call Jira's read tools with no model, through `opencode api`. It runs as a session and its
agent, under that agent's permission rules and the session's own. Write tools are never available to scripts:

```sh
opencode api post /api/rpc/jira.issues.tools/getAccessibleAtlassianResources \
  -d '{"input":{"sessionID":"ses_…","input":{}}}'
```

`describe` lists the methods and each tool's input schema; every Jira call needs a `cloudId` from
`getAccessibleAtlassianResources`.

See [Scripting](https://github.com/joe-broadhead/opencode-jira/blob/HEAD/docs/scripting.md).

## Permissions

The plugin adds these rules to every agent, directly after the agent's base rule that allows everything:

1. `{ "action": "jira_*", "resource": "*", "effect": "ask" }`: every Jira tool asks, including tools Atlassian adds
   later.
2. One `allow` rule for each of Jira's 33 read tools, listed in
   [`src/jira-tools.ts`](https://github.com/joe-broadhead/opencode-jira/blob/HEAD/src/jira-tools.ts). These run
   without a prompt. Three of them, the workflow and screen reads, sit in Atlassian's `manage_jira` group, which this
   plugin does not request, so they never arrive.
3. Seven `deny` rules, for tools that are off. A deny also hides the tool from the model.

The seven, and why:

- `{ "action": "jira_deleteJiraIssue", "resource": "*", "effect": "deny" }`: deletes a work item for good, with no
  history to restore.
- `{ "action": "jira_deleteJiraComment", "resource": "*", "effect": "deny" }`: deletes a comment for good.
- `{ "action": "jira_deleteJiraIssueAttachment", "resource": "*", "effect": "deny" }`: deletes an attachment for good.
- `{ "action": "jira_createJiraProject", "resource": "*", "effect": "deny" }`: creates a new, organisation-visible
  space with its own permissions and schemes.
- `{ "action": "jira_updateJiraProject", "resource": "*", "effect": "deny" }`: changes a project's settings for
  everyone in it.
- `{ "action": "jira_updateJiraScreen", "resource": "*", "effect": "deny" }`: changes the fields everyone in a project
  can see and edit.
- `{ "action": "jira_editJiraEntityProperty", "resource": "*", "effect": "deny" }`: writes opaque state that other Jira
  apps read, and can target a user.

Six of the seven are also **not granted by the sign-in's scope**, which this plugin pins, so Atlassian never loads them
and no admin action can change that: a new release of this plugin would have to request the scope, an admin would have
to enable the permission group, and even then a rule in an agent's own `permissions` keeps it asking. The exception is
`jira_editJiraEntityProperty`, which the grant covers: a rule like this, in the build agent's own `permissions`, turns
it into a per-call ask.

```json
{
  "agents": {
    "build": {
      "permissions": [{ "action": "jira_editJiraEntityProperty", "resource": "*", "effect": "ask" }]
    }
  }
}
```

Not in the top-level `permissions`: a top-level rule reaches every agent, Explore included. Never make a denied tool
`allow`, and don't answer "Always allow" for it: that would save an allow for every agent in the project.

So reads run and the 14 changes ask before they run. Every change can email people: a project's notification scheme
decides, and the safe assumption is that watchers, the assignee, the reporter and everyone mentioned get an email.
`jira-watchJiraIssue` emails only you, and only from then on. On a free site, Jira sends at most 100 emails a day across
the whole site, notifications and automation together, and an agent can spend them.

Everything that comes later than these rules still wins: an agent's own stricter rules (Explore cannot use Jira), your
`permissions` in `opencode.json`, and your saved "Always allow" answers. In an unattended run such as `opencode run`, a
tool that asks is refused.

Agents that exist only in your own config, and agents added by plugins that load later, are created after the plugin
adds its rules, so Jira tools can run there without asking. `/jira-status` and `/jira` name those agents and show the
default rules to put first in each one's own `permissions`. Do not put them in the top-level `permissions`, which would
loosen Explore.
[Configuration](https://github.com/joe-broadhead/opencode-jira/blob/HEAD/docs/configuration.md#permissions) has a
worked example and permission recipes.

## Configure

Set options with the object form of the plugin entry:

```json
{
  "plugins": [{ "package": "@joe-broadhead/opencode-jira", "options": { "allowUntestedHost": true } }]
}
```

| Option | Values | Default | Effect |
| --- | --- | --- | --- |
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
  "plugins": ["@joe-broadhead/opencode-jira"],
  "permissions": [{ "action": "jira_createJiraIssue", "resource": "*", "effect": "deny" }]
}
```

The delete and project-setting tools cannot run through this plugin: it pins a request without the delete or manage
scope, so Atlassian never loads them, and only a new release of the plugin can change that. An admin's permission group
and the user's `ask` rule are the two locks after it, as [Permissions](#permissions) shows for `agents.build`; neither
can lift the first.

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
| Tools: off by default | The tools the default rules deny, listed by name. See [Permissions](#permissions) to turn one on, as an ask. |
| Tools: unknown | Atlassian added tools the plugin does not know yet. They ask before they run. A known tool missing from the count is normal: Atlassian lists only the tools a grant covers. |
| Access: default rules missing or not added | Some agents lack the default rules (see the agents row), or OpenCode could not add them (see the OpenCode row). Follow the next step. |
| Account or Sites: not read yet | Nothing is wrong: the plugin learns both from your own calls. Make one Jira request in the session, then run `/jira-status` again. |
| A change is refused with no permission | This plugin's pinned request has no delete or manage scope, so Atlassian never loads those tools and no admin can add the scope to it. A new release must request it, an admin must enable the permission group, and a rule keeps it asking. |
| Sign-in succeeded but calls fail | The site is wrong, or the token was consented for another site. Sign out and in again (see [Sign in](#sign-in)) from the project folder, and name the site. |
| Rate limited | Atlassian publishes `Retry-After` and `X-RateLimit-*`. Wait the seconds it names, and make fewer calls at once. |
| The site's email stopped | A free site sends at most 100 notification emails a day, automation included, and an agent can spend them. |
| Agents without default rules | Put the default rules shown by `/jira-status` first in each listed agent's own permissions, in `opencode.json` or the agent's Markdown file, followed by your top-level rules for Jira tools. |
| OpenCode: untested | OpenCode is not 2.2.3, 2.2.4 or 2.2.5. Inside `>=2.2.3 <2.3.0` the plugin runs normally; outside it, it runs only because `allowUntestedHost` is set. If Jira misbehaves, use a tested release. |
| Signed in to the wrong Atlassian account | Remove the account in `/connect` → Jira, or run `opencode mcp logout jira` from the project folder; if it answers `MCP server not found: jira`, wait a few seconds and run it again. Then sign in again. |
| Asked to sign in again after the token expires | The sign-in could not be renewed. Sign in again with `/connect` → Jira; your Atlassian session may still be open in the browser. |
| A Jira tool is refused in `opencode run` | Nobody could answer its prompt. A read runs if you add an `allow` rule for it to the agent's own `permissions`. A change needs an interactive session: this plugin documents no `allow` for one, and a saved one would run it unasked in every agent of the project. |
| A skill seems ignored, and status names a skill to rename or move | A skill of yours with the same id, such as `jira`, replaces the plugin's. Rename or move it. |
| `/jira` is missing | The plugin did not start. Run `/plugins` to see the error. |
| `OPTIONS_INVALID` | An option is unknown or has a wrong value. The message names the option and the accepted values. |
| `HOST_UNTESTED` | Your OpenCode is outside `>=2.2.3 <2.3.0`, so the plugin did not start. Use OpenCode `>=2.2.3 <2.3.0`, or set `"allowUntestedHost": true` to run anyway. |
| `STATUS_UNAVAILABLE` | The status could not be read, or the plugin is not running. Follow the next step in the message. |
| `SKILLS_INVALID` | A skill file in the package is missing or broken. Reinstall the plugin. |
| `SERVER_NOT_REGISTERED` | The plugin could not register the `jira` server. Restart OpenCode. |
| `RULES_NOT_ADDED` | The default permission rules could not be added, so Jira tools may run without asking. Restart OpenCode. |

A script's errors from the tools RPC have their own codes, listed in
[Scripting](https://github.com/joe-broadhead/opencode-jira/blob/HEAD/docs/scripting.md#errors).

## Known limits

- **The tool table comes from Atlassian's docs.** Atlassian publishes no annotations, and this release has not been
  reconciled with a live tool list, so a tool Atlassian marks as changing data could run here as a read until a release
  does. `test/unit/jira-tools.json` records the list, and `npm run drift -- <tools.json> --strict` is the check that
  reconciles it. A common tool that arrives in the flat list but is not in that table, such as the rich-content format
  guide, asks before it runs and is counted as unknown.
- **A script's read can cross projects.** A script's session may belong to another directory than the OpenCode server
  answering it, and the read then runs under the serving location's agent rules; only a `deny` is refused in between.
  Run scripts in the project whose agent you mean. This is in the module shared with the other plugins, not in this
  one.
- **In Jelly, a tool Atlassian adds is not asked about.** Jelly applies each declared tool's effect and nothing else, so
  an undeclared tool, a write included, runs without asking until a release of this plugin declares it. A Jelly admin
  can set it to ask.

## Uninstall

Sign out while the plugin is still installed: once it is removed, OpenCode no longer knows the `jira` server and the
sign-in stays in OpenCode's credential store.

1. Sign out: remove the account in `/connect` → **Jira**, or run `opencode mcp logout jira` from the project folder
   where the plugin is installed. If it answers `MCP server not found: jira`, OpenCode is still opening that folder:
   wait a few seconds and run it again.
2. Check: `opencode auth list` no longer lists **Jira**.
3. Remove the plugin: `opencode plugin remove @joe-broadhead/opencode-jira`, then `opencode reload`.
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
