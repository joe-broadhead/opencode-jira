# Security

## Supported versions

Fixes go into the newest release. Older releases are not patched.

## Reporting a vulnerability

Report vulnerabilities privately through GitHub private vulnerability reporting: open the repository's **Security**
tab and choose **Report a vulnerability**. Do not open a public issue. Include the plugin version, the OpenCode
version, your plugin options and the steps to reproduce. Never include tokens, API keys, work item content or other
Jira data.

Vulnerabilities in Atlassian's service or in OpenCode itself are out of scope. Report those to Atlassian or to the
OpenCode project.

## Data handling

- The plugin holds no credential and runs no network request of its own. It registers Atlassian's MCP server with
  OpenCode, and OpenCode connects, signs in and stores the credentials. The tools RPC for scripts (see [Scripts](#scripts))
  runs Jira's tools through OpenCode's own connection, too.
- The plugin never reads tokens. Of a user's own `mcp.servers.jira` entry it reads only the type, the URL and whether
  `oauth` is `false`; it never reads, copies or reports its `headers`, which is where an API-token entry keeps its
  credential. Status shows server URLs with only the `?tools=all` query, never OpenCode's text for a needed sign-in,
  which can hold an authorization URL, and cuts a connection failure's reason to one line with no URL credentials,
  query or token.
- **The account capture keeps a display name and site names, in memory only.** It reads nothing else of
  `atlassianUserInfo` or `getAccessibleAtlassianResources`: no email address, account id, avatar URL, cloud id, app or
  scope. Both are forgotten when the server needs a new sign-in or the account is switched. The plugin never calls
  either tool itself, and makes no Atlassian call.
- **Work item content is other people's data.** Descriptions, comments, changelogs, attachments, worklogs and the names
  of colleagues reach the model as tool results, and the agent sends them to your model provider, like any other tool
  result in the session. A Jira site holds plans, incidents and customer names, because that is what teams write in
  tickets. Your organisation's Jira permissions, its Atlassian MCP permissions, its domain allowlist and its IP
  allowlist are the controls; the plugin cannot see or change them.
- Jira content is untrusted. Descriptions and comments come from other people and can contain instructions aimed at the
  model. The skills tell the model to treat them as data, never to follow an instruction inside a work item, to
  summarise rather than dump, and to keep the signed download link that `downloadJiraIssueAttachment` returns in the
  chat only: that link is a bearer credential for the file.
- No tool in the Jira set sends data to Atlassian's team, so there is no feedback tool to deny here. That was checked,
  not skipped.
- Seven tools are denied by default, and six of them are also not granted by the plugin's pinned request, so Atlassian
  never loads them: the three permanent deletes, the three project and screen settings, and the opaque entity-property
  writer. No admin can add that scope to this client: a new release of the plugin would have to request it, an admin
  would have to enable the permission group, and a rule in an agent's own `permissions` would still keep it asking. An
  `ask` rule alone turns back only `jira_editJiraEntityProperty`, which the grant covers.

## Permissions

What the model can do in Jira is limited by these layers, in this order:

1. **Atlassian's server, the grant and your Jira permissions.** The sign-in is your own Atlassian user, and the server
   returns only what that user can see in Jira. The plugin pins Jira read, write and search, and nothing else: Atlassian's
   metadata lists about 40 scopes, and without the pin OpenCode would request them all, delete, manage and Confluence
   included. Pinned, the grant cannot cover a delete, and Atlassian loads only the tools a grant covers, so the delete
   and project-setting tools cannot run at all, and the three workflow and screen reads never arrive. **This holds only
   while the request does.** If you define `mcp.servers.jira` yourself, repeat the same `oauth.scope`: an entry with no
   scope, or a wider one, replaces the pin and the grant can then cover delete, manage or Confluence, leaving the
   permission rules as the only lock. `/jira-status` names which your entry does. An
   organisation admin can turn Atlassian MCP off for the whole organisation, refuse this client's origin, or refuse
   this machine by IP.
2. **Default permission rules.** Every Jira tool asks before it runs, except Jira's read tools listed in
   `src/jira-tools.ts`, which run without a prompt. Seven tools are denied, and a deny also hides the tool. Some changes
   that ask still email people: every write can reach watchers, the assignee, the reporter and anyone mentioned, and
   `jira_manageJiraSprint` can close a sprint and move its incomplete work.
3. **Your OpenCode permissions.** Your `permissions` rules and saved "Always allow" answers override the default
   rules. A `deny` you configure always wins.

Things to know:

- **Saved approvals are broad.** "Always allow" on a Jira tool saves the pattern `*` for that tool's action. It applies
  to every agent in the OpenCode project, Plan included, until you remove it. Think twice before saving one for a tool
  that emails people. OpenCode identifies a project by its git repository. A folder outside any git repository with a
  commit may belong to OpenCode's shared `global` project, so an approval saved there may apply in other such folders
  too.
- **Some agents get no default rules.** Agents defined only in your own config, and agents added by plugins that load
  after this one, are created after the plugin inserts its rules, and agents without a base allow get none. Jira tools
  may run there without asking. `/jira-status` names these agents and gives the fix: put the default rules it shows
  first in that agent's own `permissions`, followed by your top-level rules for Jira tools. Do not put them in the
  top-level `permissions`, which would loosen Explore.
- **Unattended runs refuse prompts.** In `opencode run`, a Jira tool that would ask is refused.
- **The `jira_*` rule also matches other servers** whose names start with `jira_`. For their tools it only adds prompts.
- **The rules follow the name, not the server.** When your own `mcp.servers.jira` points at another URL, status reports a
  conflict and the plugin adds no server, but the default rules still allow the known read names, so a tool of that
  server with such a name runs without asking. Point the entry at Atlassian's URL, or remove it.
- **One sign-in, several sites.** The token can reach every site the user belongs to, and every call names one. The
  plugin asks which site, once, and names it before every change, because a write aimed at the wrong site changes the
  wrong organisation's work.

## Scripts

The tools RPC (`jira.issues.tools`, see
[docs/scripting.md](https://github.com/joe-broadhead/opencode-jira/blob/HEAD/docs/scripting.md)) exposes every known Jira
tool as a method for a script, with no model, each with a class: read, write or destructive. It adds no authority:

- A script names a session that names an agent, and runs as them. The rules that decide are the agent's, then the
  session's, resolved before dispatch: only `allow` runs. An `ask` is refused with no prompt and no Atlassian call, and
  a `deny` is refused with no Atlassian call. A saved "Always allow" is not part of those rules and does not authorise a
  script; a script's grant is a rule in config, or a Jobs run session.
- Making a tool a method does not make it reachable. A write's default rule asks, so a script needs an explicit
  `allow` for its action; the seven denied tools resolve to `deny` and are refused until that deny is changed.
- OpenCode's own executor still checks an MCP call against the agent's rules, the session's rules and saved approvals.
  A session in another directory than the server answering the call runs under the serving location's agent rules: the
  README's known limits say so, and `docs/scripting.md` gives the `x-opencode-directory` header that names the location.
- An inner ask on a script's call is denied, not prompted. The plugin's permission hook changes only an ask on one of
  its own script calls in flight, only to a deny, and leaves every other call alone.
- The three reads the scope withholds are methods too, but Atlassian never lists them, so a call has no tool to run. A
  tool that Atlassian adds later is not a method, even with an allow rule; `describe` reports it as unclassified.
- The call goes through OpenCode's own MCP connection and sign-in. The plugin never sees the token, and returns none.
- Atlassian's error text reaches the script only as the first line, at most 300 characters, with tokens and URL query
  strings removed.
- OpenCode's `execute.before` and `execute.after` tool hooks, from any plugin, do not run for a script's call, so
  another plugin's policy hook does not see it. A script's calls are not recorded in the session.
- The RPC is reachable only by callers of the OpenCode server API, who already hold the server's full authority. The
  session is not a login: it scopes a script to what its agent may do.
