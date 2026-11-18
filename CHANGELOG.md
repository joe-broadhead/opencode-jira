# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Admits OpenCode 2.3.1 and 2.3.2: the host range is unchanged, `>=2.2.3 <2.4.0`, tested on 2.2.3, 2.2.4, 2.2.5, 2.2.6, 2.2.7, 2.3.0, 2.3.1 and 2.3.2.
  `TESTED_HOSTS` in `src/constants.ts` is the list the host and pack stages, status and CI read.

## [0.0.4] - 2026-11-17

### Added

- `jira.activity`, a source under the source contract (`@we-the-rebel-alliance/source-contract` v0.2.0, bundled), declared
  in `package.json`'s `sources`: `events_list` (`jira_events_list`, a Code Mode tool and a tools RPC method) lists what
  changed for the signed-in person since a cursor, oldest first, one event per work item each time a read finds it
  updated (several updates between two reads are one, the latest), for every work item they are assigned, reported or
  watching on each Jira site the sign-in reaches; `probe` (`jira_probe`, a tools
  RPC method) names who is signed in from one `atlassianUserInfo` read, and records it for that sign-in, which every
  listing then names. Events carry metadata only: the key and summary, the update time, the assignee and reporter as
  Jira names them, the status, type and priority, and the link; never a description, a comment or an email address. A
  summary shaped like a secret is refused for good.
- The cursor holds each site's last update time and work item id, so work items updated in the same second are each
  listed once; it is bound to the plugin, the source and the account, and never expires. The search names its window
  in minutes before now, which the person's Jira time zone does not change, and a work item is listed once it was
  updated 5 minutes ago. Each search page is read whole and the next search opens at the last complete position;
  `nextPageToken` only walks past a burst of work items within the window's margin (up to 100 pages a site per call), and
  a larger burst is passed with a `gap` (`window-truncated`). A site missing from one answer keeps its position.
- `npm run conformance` (and the `conformance` stage of `npm run check`) runs the source contract's conformance kit over
  `jira.activity` from `test/fixtures/conformance.json` and writes `reports/conformance-report.json`, which a release
  attaches.
- The default rules allow `jira_events_list` and `jira_probe` under every `access` value; `jira.events_list` is declared
  in the Jelly block, a read.

### Changed

- The tools RPC is the source contract's `tools-rpc` module, bundled into `dist/index.js`, with Jira's part in
  `src/tools-rpc.ts`; the copy in `src/host/tools-rpc.ts` and its `check-copies` pin are gone. Scripts call the same
  `jira.issues.tools` methods, with the same codes.
- The host range is unchanged, `>=2.2.3 <2.4.0`, tested on 2.2.3, 2.2.4, 2.2.5, 2.2.6, 2.2.7 and 2.3.0.

## [0.0.3] - 2026-11-15

### Changed

- OpenCode 2.3 is admitted: the host range is `>=2.2.3 <2.4.0` (it was `>=2.2.3 <2.3.0`), tested on 2.2.3, 2.2.4, 2.2.5, 2.2.6, 2.2.7 and 2.3.0.
  The host and pack stages, CI and the release's install check run every one of them. A later 2.2 or 2.3 release
  starts and status calls it untested; the `HOST_UNTESTED` example host is now 2.4.0.
- Apart from the status fix below, OpenCode 2.3 needs nothing else from this plugin. It does not call the `subagent`
  tool or read `session.tool.failed`; Jira's tools are Atlassian's MCP tools, which OpenCode runs and stops itself when
  the person presses Stop; and it has no use for the new `session.fork` hook.
- The host test of a call that names another location waits until the plugin has loaded there: from OpenCode 2.2.7 a
  location opened by a call answers `rpc.unavailable` until its plugins have registered.

### Fixed

- Status, `/jira-status` and the `/jira` dialog read the server's source and the default rules' outcome after listing
  the servers and agents. OpenCode records them only when something reads that state, so right after start-up a status
  read could miss them.

## [0.0.2] - 2026-11-14

### Added

- `test/fixtures/live-tools.json`, Atlassian's tool list for this plugin's sign-in, captured live on 14 November 2026,
  and a test that fails when the declaration and that list disagree. Atlassian serves 46 of the 55 declared tools.

### Changed

- Jelly's declaration notes the nine tools the pinned scope keeps out (the three `manage_jira` reads, the three deletes,
  and the project and screen tools). They stay declared, so a sign-in of your own with a wider scope keeps every change
  fenced from a read-only helper; `test/fixtures/tool-registry.json` records each as scope-gated, with the reason.
- `docs/jelly.md` gives the reason `downloadJiraIssueAttachment` is declared not read-only although Atlassian marks it
  read-only: it returns a signed URL, a credential for the file.
- The README's sign-out sentence names `opencode mcp logout jira`.
- The icon is now Jira's own icon, the tile Atlassian publishes in `@atlaskit/logo` (`JiraIcon`), in place of the family's board-of-cards mark; `opencode.vendor.mark` is `true`.
- OpenCode support is unchanged: `>=2.2.3 <2.3.0`, tested on 2.2.3, 2.2.4, 2.2.5 and 2.2.6.

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
