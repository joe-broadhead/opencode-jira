# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The icon is now Jira's own icon, the tile Atlassian publishes in `@atlaskit/logo` (`JiraIcon`), in place of the family's board-of-cards mark; `opencode.vendor.mark` is `true`.

## [0.0.1] - 2026-11-13

### Added

- The `jelly` settings declare their choices: `access` offers Jelly's three (Allowed, Ask before changes, Read only), so
  Jelly draws it as a choice instead of free text. A test reads the settings with Jelly's setting rules and checks that
  the options parser takes every declared value and refuses one outside the set (needs a jelly that includes
  app#1301). OpenCode support is unchanged: `>=2.2.3 <2.3.0`, tested on 2.2.3, 2.2.4, 2.2.5 and 2.2.6.

## [0.0.0] - 2026-11-10
<!-- kit-release: the GitHub release v0.0.0 -->

### Changed

- Both skills explain how to connect Jira when its tools are absent, including the organisation's Atlassian MCP prerequisite.

- Default permission rules after each agent's base allow: every Jira tool is allowed, reads, writes, deletes and the
  attachment export alike, and the namespace pattern covers a tool Atlassian adds later. The `access` option restricts
  them: `all` (the default), `ask-changes` allows a read and asks for everything else, and `read-only` denies everything
  but a read. Six of the seven destructive tools are also not granted by the sign-in's scope.
- The tools RPC is v2: every known tool is scriptable under a prior explicit allow, each method carries its class,
  `describe` takes a session and reports each method's permission, and `shapeInput` runs beside `shapeResult` so a
  script's call reaches Atlassian with the model path's arguments. A saved "Always allow" no longer authorises an
  ad-hoc script: a grant is a rule in config, or a Jobs run session.

### Added

- Jelly shows an `access` setting (`all`, `ask-changes` or `read-only`; `all` by default), the option the plugin already reads.
- Registers Atlassian's official MCP server, `https://mcp.atlassian.com/v2/mcp?tools=all`, as `jira`, signed in with
  OpenCode's own MCP OAuth. The sign-in asks for Jira read, write and search only, plus your account name and an
  offline token: no delete, no manage, and no Confluence, so Atlassian never loads those tools.
- Names the server's `/connect` entry "Jira", and marks its account "Sign in required" while the server needs a new
  sign-in.
- Adopts your own `mcp.servers.jira` at Atlassian's URL, query included, unchanged. The plugin never reads its headers.
  A plain `/v2/mcp`, a v1 URL, another origin or a local command is a conflict that status explains.
- `/jira-status` and the `/jira` dialog ("Jira: Status" in the palette): connection, account, sites, access, tools, the
  tools this plugin's scope does not grant, agents without the default rules, the OpenCode check and one next step. A
  skill of yours with one of the plugin's ids is named, with a next step.
- The account and site rows come from your own `atlassianUserInfo` and `getAccessibleAtlassianResources` results: a
  display name and site names only, kept in memory, and forgotten on a sign-out or an account switch.
- The status RPC `jira.issues/status`, with the fields this family of plugins shares.
- The tools RPC `jira.issues.tools`, which lets scripts call Jira's tools with no model, each under a prior explicit
  allow, as a session and its agent.
- Two skills: `jira` (the site rule, finding a work item, JQL, boards, sprints, versions, filters, attachments, and the
  rules for other people's words and data) and `jira-write` (whom each change emails, said before the call, the
  operation behind the sprint and version tools, and OpenCode's permission prompt as the yes).
- The options `access` and `allowUntestedHost`, and a host check for OpenCode `>=2.2.3 <2.3.0`, tested on 2.2.3, 2.2.4, 2.2.5 and 2.2.6.
- A `jelly` declaration for Jelly: the tools with their default effects, the skills, the sign-in, a summary and an
  icon.
- The family icon kit's mark and its 128 and 256 pixel rasters, declared in `opencode.icons` and exported from the
  package, with `opencode.vendor` naming Atlassian's domain: a display app may show Atlassian's own logo from
  Atlassian's site, and the package carries no vendor marks.
