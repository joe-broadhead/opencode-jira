# Repository rules

This repository builds `@joe-broadhead/opencode-jira`, an OpenCode plugin that registers Atlassian's official MCP
server and adds default permission rules, a status command, a status dialog, two skills and a tools RPC for scripts.
It has no tool of its own. Read [docs/architecture.md](docs/architecture.md) before you change code, and
[CONTRIBUTING.md](CONTRIBUTING.md) for the checks and the release steps.

## Rules

- **Public API only.** Use only the public `@opencode/plugin` 2.2.3 API. `opencode.host` in `package.json` and
  `SUPPORTED_HOST` in `src/constants.ts` both say exactly `>=2.2.3 <2.3.0`, never `^2.2.3`. `TESTED_HOSTS` in
  `src/constants.ts` is the one list of tested releases (2.2.3, 2.2.4 and 2.2.5): status calls only those tested, and
  the host and pack stages and CI run on each. Inside the range an untested release still starts.
- **Greenfield.** No legacy, migration code, compatibility shim, dual path or deprecated alias, and nothing dead.
  Delete rather than deprecate.
- **No peers, no runtime dependencies, no lifecycle scripts.** `@opencode/plugin`, `@opencode/sdk` and
  `@opencode/client` (whose types the host tests use) are devDependencies pinned to exactly `2.2.3`. Do not add another
  host version to the lockfile: the host stage installs the other tested SDKs into a temp folder.
- **Ship prebuilt, one file per entry.** `scripts/build.mjs` bundles `src/index.ts` and `src/tui.ts` with esbuild into
  the self-contained `dist/index.js` and `dist/tui.js`: no chunks, no relative imports, and only host-provided modules
  external. `tsc` only typechecks. No declaration files, `.tsx` or JSX.
- **One endpoint string.** `ENDPOINT` in `src/constants.ts` is the only place Atlassian's URL is written in code; the
  pack test points the built plugin at a fake by replacing its one occurrence in `dist/index.js`.
- **The pinned scope is the guard.** The sign-in entry is `{ type: "remote", url, oauth: { scope: OAUTH_SCOPE } }`.
  Atlassian's 401 names no scope and its metadata lists about 40, so without the pin OpenCode would request every one:
  `delete:jira:agent-interface`, `manage:jira:agent-interface`, Confluence, Jira Service Management and Teamwork Graph
  included, leaving only the rules between the model and a delete. The pin keeps the grant to Jira read, write and
  search, and Atlassian then loads no delete or project-setting tool at all. The fake advertises the whole list, so the
  host and pack tests fail if the pin is removed. Never add `client_id` or `redirect_uri`, which would turn the client ID
  metadata document off; only the tests' seam sets `oauth: false`.
- **Adoption compares the query.** `?tools=all` decides which tool list the server sends, so `sameServer` compares
  origin, path and query. A plain `/v2/mcp`, a v1 URL, another origin or a local command is a conflict. Of a user's entry
  the plugin reads only its type, URL and whether `oauth` is `false`, never its `headers`.
- **Default rules, not hooks.** Permissions come from rules inserted through `ctx.agent.transform` directly after each
  agent's base allow. A stricter agent is never weakened. An agent counts as guarded only with the whole block after
  its base allow. Agents that miss the rules are named in status with the per-agent fix, never patched, and the fix
  never goes in the top-level `permissions`.
- **Transforms are cheap, synchronous and never throw.** Record failures for status instead.
- **Errors** read `CODE: What happened. Next step: What to do.`, built by `jiraError` or `errorText`. Codes have no
  service prefix; shared failures use the shared names (`HOST_UNTESTED`, `OPTIONS_INVALID`, `STATUS_UNAVAILABLE`,
  `SKILLS_INVALID`).
- **Status.** `src/status.ts` builds one model for `/jira-status`, the `/jira` dialog and the status RPC. The RPC keeps
  the fields every plugin of this family shares, `version`, `host` (`version`, `range`, `tested`), `state`,
  `unguardedAgents` and `nextStep`, under those names. Its `Sites` row is between `Access` and `Tools`. It never shows
  OpenCode's text for a needed sign-in, cuts a failure's reason to one line of 160 characters with `src/redact.ts` (no
  credentials, URL queries or tokens), and names at most 20 unknown tools, plain names only. A status it cannot read is
  the declared RPC error `unavailable`, with a next step. Status makes no Atlassian call: the account name and the site
  names come from the user's own first calls, captured in `src/account.ts` and kept in memory only.
- **`src/jira-tools.ts` is the one record of Jira's tools**, and has no runtime imports. Everything else derives from
  it; `jelly.tools` and the skills are checked against it. Its names come from Atlassian's docs and `PARAMETERS` is
  empty until a tool list from a signed-in server is recorded: reconciling is a change to that file,
  `test/unit/jira-tools.json`, `jelly.tools` and the skills, which `npm run drift` guides. `NOT_GRANTED_TOOLS` is the
  three `manage_jira` reads the scope does not grant. `src/constants.ts` has no imports at all: `scripts/check.mjs`
  loads it with Node's type stripping.
- **Work items are other people's words and data.** Tests, fixtures, docs and skills use only invented people,
  projects and keys. Status shows no email address, account id, cloud id or avatar URL. The skills label Jira content as
  data and never as instructions, say whom a change emails before it asks, and leave every decision to the user.
- **The `jelly` section** of `package.json` declares every known tool, the skills, the sign-in, a one-line `summary`
  and the `icon`, with only the keys Jelly reads: its contracts drop an unknown top-level key, and refuse an unknown key
  inside a tool, sign-in or `contributes` entry. `test/unit/jelly.test.ts` keeps it in step with the tool lists and the
  default rules.
- **The icon** is this family's own mark, from the family icon kit: `assets/icon.svg`, a neutral board of cards on a
  slate tile, with the `icon-128.png` and `icon-256.png` rasters rendered from it, no Atlassian blue, no "A" mark and no
  Jira logo, because the plugin is unofficial. `opencode.icons` declares all three and `opencode.vendor` names
  Atlassian's domain, so a display app may fetch Atlassian's official logo from Atlassian's own site; the package
  carries no vendor marks. `scripts/check-icons.mjs` is the kit's check, copied verbatim, and is the one definition of
  a safe icon: it runs in the `icons` stage of `npm run check`.
- **TypeScript.** No enums, namespaces or parameter properties. `import type` for types, `.js` in relative imports.
- **The tools RPC.** `src/host/tools-rpc.ts` is a copy of a module shared by several plugins. Change only its block
  between the `PLUGIN-SPECIFIC` markers here; change the rest in the shared copy first. Its methods are `KNOWN_READS`
  and nothing else: never a write, a denied tool, a scope-withheld read or an unknown tool. Keep the RPC id
  `jira.issues.tools` and its method names stable: scripts call them by name.
- **Tests.** Unit tests use narrow `Pick<Plugin.Context, ...>` fakes. Host tests use the public `@opencode/sdk` with
  `OpenCode.create({ app: { version } })`, a loopback fake server and the temp root from `test/host/isolate.ts`.
  Every temp root of the host and pack tests is a git repository under the system's `/tmp`, never under `TMPDIR` or
  `HOME`, so OpenCode never finds a `.opencode` folder of whoever runs them; each stock server has its own port.
  Never sign in to Atlassian or call its API from a check.
- **Text.** Model-facing text and docs use plain language and describe what the code does now: no process
  narrative, test counts, machine-local paths, secrets or personal data.
- **Releases** come from a `v<version>` tag on `master`. The release workflow refuses a private package or a tag that
  differs from the version; no test or script checks `private`.
- **One check command.** `npm run check` passes before every commit. Never skip, weaken or delete a test to get
  green.

## Forbidden in this repository

`scripts/check-forbidden.mjs` enforces this list in `src/`, `test/`, `scripts/` and `dist/`:

- dispatch-lease, catalog-ownership and text-only markers, and tool `options.mcp` delegation;
- `Plugin.image` and profile images;
- imported OAuth grants;
- the V1 plugin API: `@opencode-ai/*` packages and hooks such as `tool.execute.before`, `chat.message` or
  `permission.ask`;
- the deprecated `ctx.generate.text` and `experimental.policies`;
- importing `@opencode/ai`;
- a permission hook, except the one `permission.hook("evaluate")` in `src/host/tools-rpc.ts` (and the bundle that
  inlines it), exactly once each: it turns an `ask` on one of the tools RPC's own script calls in flight into a deny,
  because no one can answer it, and touches nothing else;
- references to private host source or host checkouts;
- machine-local home and temp paths;
- `.tsx` or `.jsx` files in `dist/`.

The pack test also rejects anything in `dist/` other than the two bundles, any relative, dynamic or `require` import in
them, and any import of a module OpenCode does not provide.
