# Configuration

Every option is optional. The smallest setup is one entry in `plugins`:

```json
{
  "plugins": ["@joe-broadhead/opencode-jira"]
}
```

To set options, use the object form:

```json
{
  "plugins": [{ "package": "@joe-broadhead/opencode-jira", "options": { "allowUntestedHost": true } }]
}
```

## Options

### `access`

- Type: `"all"`, `"ask-changes"` or `"read-only"`.
- Default: `"all"`.

How much the default rules restrict. `all` allows every Jira tool; `ask-changes` allows a read and asks for every other
tool; `read-only` allows a read and denies every other tool, which also hides it from the model. The classes come from
`src/jira-tools.ts`, so the value decides a tool Atlassian adds later too. [Permissions](#permissions) has the three
generated blocks.

### `allowUntestedHost`

- Type: `true` or `false`.
- Default: `false`.

The plugin supports OpenCode `>=2.2.3 <2.3.0`, the range `opencode.host` in `package.json` declares, and every check
runs on 2.2.3, 2.2.4, 2.2.5 and 2.2.6, the tested releases. Status shows the version, whether it is tested and the supported
range in its `OpenCode` row, for example `2.2.5 (tested; supported range >=2.2.3 <2.3.0)`.

- **A tested release:** the plugin starts.
- **Another release inside the range, such as 2.2.99:** the plugin starts too. Status marks the version `untested`, and
  the status RPC's `host.tested` is `false`. The next step is the same as on a tested release.
- **Outside the range, including 2.3.0, prereleases and development builds:** the plugin refuses to start, and
  `/plugins` shows:

  ```text
  HOST_UNTESTED: This plugin supports OpenCode >=2.2.3 <2.3.0, found 2.3.0. Next step: Use OpenCode >=2.2.3 <2.3.0, or set the plugin option "allowUntestedHost": true to run anyway.
  ```

- **Outside the range with `"allowUntestedHost": true`:** it starts anyway, and `/jira-status` and `/jira` show a
  warning.

There is no other option. To narrow what the model may do in Jira per agent or per tool, use permission rules; see
[Permissions](#permissions).

## Your own `mcp.servers.jira`

If your config defines no server named `jira`, the plugin registers one:

```json
{
  "type": "remote",
  "url": "https://mcp.atlassian.com/v2/mcp?tools=all",
  "oauth": { "scope": "read:me read:account offline_access read:jira:agent-interface write:jira:agent-interface search:jira:agent-interface" }
}
```

- **`?tools=all` is part of the address.** Without it, Atlassian sends a small meta-tool set (`discover`, `executeRead`,
  `executeWrite`, `executeDestructive`) instead of one named tool per Jira tool, and this plugin's rules would not match.
- **The scope is pinned**, because Atlassian's sign-in challenge names none while its metadata lists about 40 scopes:
  without the pin OpenCode would request every one of them, `delete:jira:agent-interface`,
  `manage:jira:agent-interface`, Confluence, Jira Service Management and Teamwork Graph included. The pinned set keeps
  the grant to Jira read, write and search, the second copy of the plugin's deny list, so Atlassian loads no delete or
  project-setting tool at all.
- **No client ID and no `redirect_uri` are set**, so OpenCode uses its own client ID metadata document. OpenCode
  registers itself with Atlassian's sign-in server on first use, and OpenCode's defaults apply to everything else.

To change anything else, define `mcp.servers.jira` yourself at Atlassian's URL with the same query. The plugin then
**adopts** your entry unchanged, and `/jira-status` shows "Connection: connected (…, your own mcp.servers.jira, used
unchanged)". The permission rules and skills still apply. Of your entry the plugin reads its type, its URL, whether
`oauth` is `false` and its `oauth.scope`; it never reads, copies or reports its `headers`.

**Repeat the scope in your own entry.** An entry with no `oauth.scope`, or with one wider than the pin, replaces the
plugin's request: OpenCode then asks Atlassian for no scope, or for more, and its fallback is every scope the metadata
advertises, the 40 above included. Paste the same six, so the grant stays Jira read, write and search:

```json
"oauth": { "scope": "read:me read:account offline_access read:jira:agent-interface write:jira:agent-interface search:jira:agent-interface" }
```

`/jira-status` says when an entry asks for too much or names no scope, and repeats that line. It never changes your
config.

### If the browser comes back to a blank page

Atlassian may refuse the loopback callback on an ephemeral port. The fix needs no plugin change: name the callback
yourself, which also makes OpenCode register that exact redirect with Atlassian's dynamic registration instead of using
its client ID metadata document.

```json
{
  "type": "remote",
  "url": "https://mcp.atlassian.com/v2/mcp?tools=all",
  "oauth": { "scope": "read:me read:account offline_access read:jira:agent-interface write:jira:agent-interface search:jira:agent-interface", "redirect_uri": "http://127.0.0.1:3334/callback", "callback_port": 3334 }
}
```

Then sign in again and allow `127.0.0.1:3334` in any local firewall.

### An API-token entry, for a headless machine

OAuth is the plugin's path, and the one `/connect` offers. Atlassian also documents an API token for clients that
cannot open a browser, only when an organisation admin enables it in Atlassian Administration, Connectors, Atlassian MCP
server, Authentication. It is a long-lived credential in a config file that skips the consent screen, and its reach is
whatever the token's scopes allow. The plugin builds nothing for it: such an entry is adopted like any other, and status
marks it "your own mcp.servers.jira without OAuth".

```json
{
  "type": "remote",
  "url": "https://mcp.atlassian.com/v2/mcp?tools=all",
  "oauth": false,
  "headers": { "Authorization": "Basic <base64 of email:api-token>" }
}
```

Atlassian issues personal API tokens at `id.atlassian.com` under **Security**, **API tokens**. The plugin never reads
that `headers` block, and never shows it in status, a script's result or an error.

### A conflict

The plugin compares origin, path and query: a plain `/v2/mcp`, a v1 URL, another origin, or a local command is a
**conflict**. It leaves your entry alone, adds nothing, status shows "Connection: conflict", and gives the next step:

```text
- Next step: Your OpenCode config defines mcp.servers.jira with https://mcp.atlassian.com/v2/mcp, but the plugin uses https://mcp.atlassian.com/v2/mcp?tools=all. Point it at https://mcp.atlassian.com/v2/mcp?tools=all or remove it, then restart OpenCode.
```

## Permissions

OpenCode asserts every MCP call itself, with the action `jira_<tool>` and the resource `*`. The plugin adds its
block to every agent that starts with the base rule `{ "action": "*", "resource": "*", "effect": "allow" }`, directly
after that rule. The README prints the whole block, rule for rule, in
[Permissions](https://github.com/joe-broadhead/opencode-jira/blob/HEAD/README.md#permissions); `/jira-status` prints
it too, and its `Agents without default rules` row prints it as a list to paste.

`READ_TOOLS` in `src/jira-tools.ts` lists Jira's read tools, `EXPORT_TOOLS` the one that mints a signed URL,
`WRITE_TOOLS` its write tools, and `DESTRUCTIVE_TOOLS` the seven that `access: "read-only"` denies and
`access: "ask-changes"` asks for. A tool Atlassian adds later matches `jira_*` alone, and takes the same value's
effect. `/jira-status` names the tools in no list. Atlassian lists only the tools a grant covers, so a known tool can be
missing; that is normal, and `NOT_GRANTED_TOOLS` names the three that this plugin's scope never grants.

**Every tool is allowed by default**, so nothing is switched off for you. These deserve their own sentence before you
decide:

- `jira_downloadJiraIssueAttachment` mints a short-lived signed URL and a curl command, which is a file credential. Its
  output belongs in your chat only.
- `jira_createJiraProject` creates a new organisation-visible space, with its own permissions, schemes and members.
- `jira_updateJiraProject` changes a space's settings for everyone in it.
- `jira_updateJiraScreen` changes a company-managed screen's fields for everyone in the project, so it changes what other
  people can see and edit.
- `jira_deleteJiraIssue`, `jira_deleteJiraComment` and `jira_deleteJiraIssueAttachment` delete permanently: there is no
  history to restore.
- `jira_editJiraEntityProperty` writes opaque key/value state that other Jira apps and integrations read, and can target a
  user.

There are three ways to restrict the block, and everything later still wins:

1. the `access` option, for the whole plugin;
2. the agent's own `permissions`, for one agent;
3. your top-level `permissions`, which OpenCode adds to every agent.

### `access`

| Value | What runs |
| --- | --- |
| `all` (the default) | every Jira tool runs without a prompt |
| `ask-changes` | a read runs; every other tool asks, including one Atlassian adds later |
| `read-only` | a read runs; every other tool is denied, and hidden from the model |

The value generates the block from the tool table's classes, so `/jira` and `/jira-status` always show what is in
force; the README prints the three blocks in full. A namespace rule (`jira_*`) comes first, and each known tool's own
rule after it, so a tool Atlassian adds later takes the value's own effect.

### Recipes

To restrict one agent, put the rules in that agent's own `permissions`; a top-level `ask` or `allow` would reach every
agent, Explore included. A read-only agent that asks for one change:

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

Never create work items, in any agent (a `deny` also hides the tool):

```json
[{ "action": "jira_createJiraIssue", "resource": "*", "effect": "deny" }]
```

Keep closing sprints and releasing versions out of every agent, including ones added later:

```json
[
  { "action": "jira_manageJiraSprint", "resource": "*", "effect": "deny" },
  { "action": "jira_manageJiraProjectVersion", "resource": "*", "effect": "deny" }
]
```

A single tool off for everyone, in the top-level `permissions`:

```json
{ "action": "jira_deleteJiraIssue", "resource": "*", "effect": "deny" }
```

Six of the seven destructive tools are also not granted by the plugin's pinned request, so with `access: "all"` they
still never arrive, and no admin action can supply the missing scope: a new release of the plugin must request it and an
organisation admin must enable the permission group. `jira_editJiraEntityProperty` sits in the write group, so it is
granted, and the deny above is the lock that keeps it off.

Use only the rules you need. Two tools do several operations behind one name: `jira_manageJiraSprint` and
`jira_manageJiraProjectVersion`, which include closing a sprint and releasing a version. A rule cannot see which
operation a call makes, so the skill names it before the call.

OpenCode uses the last rule that matches, so everything after the plugin's rules wins:

1. the agent's own rules, such as Explore's, which turn Jira off there;
2. your top-level `permissions`, which OpenCode adds to every agent;
3. your saved "Always allow" answers, which beat an `ask` but never a configured `deny`.

A `deny` on resource `*` also hides the tool from the model. In an unattended run such as `opencode run`, a tool that
asks is refused. An agent without the base rule gets no Jira rules and keeps its own behaviour.

### Agents that miss the rules

OpenCode creates agents that exist only in your config after plugins add their rules, so those agents get no Jira
rules; agents that a later plugin adds are in the same position. An agent counts as guarded when the plugin's whole block
appears anywhere after its base allow. Under `access: "all"` that changes nothing, because the block restates the base
allow; under `ask-changes` or `read-only`, `/jira-status` and `/jira` list every other agent that has a base allow and
where a new Jira tool would run unrestricted, by name, followed by the default rules to paste. The next step reads:

```text
Put the default rules shown by /jira-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Jira tools.
```

Put the block first in that agent's own `permissions`, then repeat after it any top-level rules you have for `jira_*`
tools, so yours keep winning. Never put the block in the top-level `permissions`: top-level rules come after every
agent's own rules, so it would loosen Explore. For an agent `reviewer`, with one top-level rule of your own:

```json
{
  "permissions": [{ "action": "jira_createJiraIssue", "resource": "*", "effect": "deny" }],
  "agents": {
    "reviewer": {
      "description": "Reviews changes",
      "mode": "subagent",
      "permissions": [
        { "action": "jira_*", "resource": "*", "effect": "ask" },
        { "action": "jira_getJiraIssue", "resource": "*", "effect": "allow" },
        { "action": "jira_createJiraIssue", "resource": "*", "effect": "deny" }
      ]
    }
  }
}
```

Copy the full block from your own `/jira-status` output: the sample above keeps the first read allow and your own rule,
and leaves out the rest.

## Errors

Every error from the plugin reads `CODE: What happened. Next step: What to do.`

| Code | When | Next step |
| --- | --- | --- |
| `OPTIONS_INVALID` | Setup: an option is unknown or has a wrong value. `/plugins` shows the message, which names the option and the accepted values. | Fix the plugin options in `opencode.json`. |
| `HOST_UNTESTED` | Setup: OpenCode is outside `>=2.2.3 <2.3.0`, and `allowUntestedHost` is not set. | Use OpenCode `>=2.2.3 <2.3.0`, or set `"allowUntestedHost": true`. |
| `STATUS_UNAVAILABLE` | `/jira-status`, `/jira` or the status RPC: the status could not be read, or the plugin is not running on the server. The RPC answers with its error `unavailable`. | The message's own next step: restart OpenCode and run the command again, or, when the plugin is not running, run `/plugins` to see why. |
| `SKILLS_INVALID` | Setup: a skill file is missing or broken. The plugin still starts; status shows the problem. | Reinstall the plugin. |
| `SERVER_NOT_REGISTERED` | Setup: the `jira` server could not be registered. Status shows the problem. | Restart OpenCode. |
| `RULES_NOT_ADDED` | Setup: the default permission rules could not be added, so Jira tools may run without asking. Status shows the problem. | Restart OpenCode. |

For example:

```text
OPTIONS_INVALID: Unknown option "apiKey". Accepted options: "allowUntestedHost", "access". Next step: Fix the plugin options in opencode.json, for example "plugins": [{ "package": "@joe-broadhead/opencode-jira", "options": { "access": "ask-changes" } }].
```

Errors from Atlassian's server and from OpenCode pass through unchanged, including `invalid_token`, a refusal for a scope
the token lacks, and the IP allowlist's `You don't have permission to connect from this IP address.` In the tools RPC for
scripts, Atlassian's error becomes `UPSTREAM_ERROR` with its first line; the codes are in
[Scripting](scripting.md#errors).

## Status and RPC

`/jira-status`, the `/jira` dialog and the RPC method `status` (RPC ID `jira.issues`) share one status model. It holds no
token, no header and no URL query, and makes no Atlassian call. `version`, `host`, `state`, `unguardedAgents` and
`nextStep` are the fields every plugin of this family shares, with the same names and meanings:

| Field | Content |
| --- | --- |
| `version` | The plugin's version |
| `access` | The `access` value in force: `all`, `ask-changes` or `read-only`. |
| `state` | `connected`, `sign_in_required`, `connecting`, `disabled`, `failed`, `not_configured` or `conflict`. The `Connection` row shows the same states as `connected`, `sign-in required`, `connecting`, `disabled`, `failed`, `not configured` and `conflict`. |
| `error` | For a failed connection only: OpenCode's reason, on one line of at most 160 characters, with any URL cut before its query. The text for a needed sign-in can hold an authorization URL, so it is never shown. |
| `source` | `type` (`plugin`, `adopted` or `conflict`), `url`, `signIn` (`oauth`, or `own` for your own entry with `"oauth": false`), `scope` for an adopted entry (`pinned`, `missing`, `wider`, `narrower` or `token`), and for a conflict the `expected` URL |
| `account` | The display name from your last `atlassianUserInfo` result, on one line of at most 80 characters; absent before one. Never an email address or an account id. |
| `sites` | The site names from your last `getAccessibleAtlassianResources` result, at most ten, in its order; empty before one. Never a cloud id, a URL or an app. |
| `tools` | How many Jira tools OpenCode lists that the plugin knows; a tool Atlassian adds is counted under `unknownCount`. |
| `destructiveTools` | The listed tools of the destructive class, such as `editJiraEntityProperty`. What happens to them follows `access`. `deniedTools` carries the same list under its old name. |
| `notGranted` | The three known reads this plugin's scope does not grant, so Atlassian never lists them. Empty for your own entry, whose scope is its own. |
| `listing` | True while a server that connected moments ago lists no tools yet. The next step is then to run `/jira-status` again in a few seconds, not to ask an admin. |
| `unknownCount`, `unknownTools` | How many of them the plugin does not know, and at most 20 of their names, only those made of lowercase letters, digits and `_` |
| `unguardedAgents` | Agents where a new Jira tool would run unrestricted under `ask-changes` or `read-only`; always empty under `all`, where the block restates the base allow. An agent whose own rules already ask or deny for every Jira tool is not listed. |
| `shadowedSkills` | Present only when a skill with one of the plugin's ids, such as your own `jira` skill, replaces the plugin's: each `id` and the `path` OpenCode loads instead |
| `host` | `version` (`null` if OpenCode reports none), `range` (the supported range) and `tested` (true only for 2.2.3, 2.2.4, 2.2.5 and 2.2.6) |
| `problems` | Setup problems, each `CODE: What happened. Next step: What to do.` |
| `nextStep` | Exactly one next step: the `Next step` row, `Nothing to do.` when nothing is needed |

The `Access` row starts with the `access` value and the posture it gives, from the tool lists: "access all: every Jira
tool is allowed, reads and changes alike", or under `read-only`, "reads run without asking; the 14 writes and the 7
destructive tools are denied". Then what the request leaves out, from `notGranted`: "and getJiraScreen,
getJiraWorkflowEditorLink and getJiraWorkflows are not granted either". An adopted entry of your own instead says what
its own `oauth.scope` asks for: that it asks for no scope, more than the pin, or less, each with the `"oauth": {
"scope": … }` line to paste. Then the row says whether the default rules are in place: "every agent has the block",
"default rules missing in the agents listed below", or "default rules not added (see the OpenCode row)".

The `Sites` row names the sites your account reaches, or says the read has not happened yet. It sits between `Access` and
`Tools`.

There is no `grantedScope` field, and there cannot be one: the scopes Atlassian actually granted are inside
OpenCode's credential, which this plugin never reads. `notGranted` states what the plugin's own request leaves out. It
holds the three reads for the plugin's own server and for an adopted entry that repeats the pin, and is empty for an
entry with no scope, a wider one, a narrower one or an API token, where the entry's own request decides. `source.scope`
says which of those an adopted entry is.

When the status cannot be read, the method answers with its error `unavailable`: the message
`STATUS_UNAVAILABLE: Could not read Jira's status (…).` and `data: { nextStep }`.
