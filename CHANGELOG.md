# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.0] - Unreleased

### Added

- Registers Atlassian's official MCP server, `https://mcp.atlassian.com/v2/mcp?tools=all`, as `jira`, signed in with
  OpenCode's own MCP OAuth. The sign-in asks for Jira read, write and search only, plus your account name and an
  offline token: no delete, no manage, and no Confluence, so Atlassian never loads those tools.
- Names the server's `/connect` entry "Jira", and marks its account "Sign in required" while the server needs a new
  sign-in.
- Adopts your own `mcp.servers.jira` at Atlassian's URL, query included, unchanged. The plugin never reads its headers.
  A plain `/v2/mcp`, a v1 URL, another origin or a local command is a conflict that status explains.
- Default permission rules after each agent's base allow: every Jira tool asks, and Jira's read tools run without a
  prompt. Seven tools are denied: the three permanent deletes, the three project and screen settings, and
  `jira_editJiraEntityProperty`. Six of them are also not granted by the sign-in's scope.
- `/jira-status` and the `/jira` dialog ("Jira: Status" in the palette): connection, account, sites, access, tools, the
  tools this plugin's scope does not grant, agents without the default rules, the OpenCode check and one next step. A
  skill of yours with one of the plugin's ids is named, with a next step.
- The account and site rows come from your own `atlassianUserInfo` and `getAccessibleAtlassianResources` results: a
  display name and site names only, kept in memory, and forgotten on a sign-out or an account switch.
- The status RPC `jira.issues/status`, with the fields this family of plugins shares.
- The tools RPC `jira.issues.tools`, which lets scripts call Jira's read tools with no model, as a session and its
  agent.
- Two skills: `jira` (the site rule, finding a work item, JQL, boards, sprints, versions, filters, attachments, and the
  rules for other people's words and data) and `jira-write` (whom each change emails, said before the call, the
  operation behind the sprint and version tools, and OpenCode's permission prompt as the yes).
- The option `allowUntestedHost`, and a host check for OpenCode `>=2.2.3 <2.3.0`, tested on 2.2.3, 2.2.4 and 2.2.5.
- A `jelly` declaration for Jelly: the tools with their default effects, the skills, the sign-in, a summary and an
  icon.
- The family icon kit's mark and its 128 and 256 pixel rasters, declared in `opencode.icons` and exported from the
  package, with `opencode.vendor` naming Atlassian's domain: a display app may show Atlassian's own logo from
  Atlassian's site, and the package carries no vendor marks.
