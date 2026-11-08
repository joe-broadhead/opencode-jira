# Contributing

Read [AGENTS.md](AGENTS.md) first: it lists the rules for this repository and the APIs that must never appear in it.
[docs/architecture.md](docs/architecture.md) explains how the plugin works.

## Set up

You need Node.js 22.18 or later, npm, and [Bun](https://bun.sh). CI and the release use Node.js 24 and Bun 1.4.4,
the Bun inside stock OpenCode 2.2.3, 2.2.4, 2.2.5 and 2.2.6.

```sh
npm ci --ignore-scripts
```

### Run your checkout in OpenCode

```sh
npm run build
```

Then list the folder in `plugins`, as an absolute path or a path relative to the config file that contains it, and
restart OpenCode. One entry loads both the server part and the terminal UI part. Run `npm run build` again after you
pull changes.

```json
{
  "plugins": ["/path/to/opencode-jira"]
}
```

## Check

One command runs every check, in order, and stops at the first failure:

```sh
npm run check
```

| Stage | What it does |
| --- | --- |
| `typecheck` | `tsc --noEmit` over `src/` and `test/`, strict, with unused names as errors |
| `unit` | `bun test ./test/unit`: every module in `src/`, the docs' counts and error table, and the Jelly declaration |
| `build` | `node scripts/build.mjs`: deletes `dist/` and bundles `src/index.ts` and `src/tui.ts` with esbuild into the self-contained `dist/index.js` and `dist/tui.js`. Fails if a bundle imports anything the host does not provide |
| `host` | `bun test ./test/host`: the plugin inside an embedded OpenCode host, once on each tested release (`@opencode/sdk` 2.2.3, 2.2.4, 2.2.5 and 2.2.6) |
| `pack` | `bun test ./test/pack`: builds, packs and installs the package, imports both entry points, and loads it in stock OpenCode 2.2.3, 2.2.4, 2.2.5 and 2.2.6 |
| `forbidden` | `node scripts/check-forbidden.mjs`: scans `src/`, `test/`, `scripts/` and `dist/` for forbidden APIs and machine-local paths |
| `icons` | `node scripts/check-icons.mjs`: the SVG is clean and exact, the 128 and 256 PNGs exist, and `exports` and `files` agree |
| `whitelist` | Checks `package.json` against the approved package shape, and that `dist/` holds exactly `index.js` and `tui.js` |

To run some stages only, name them; they run in the order given:

```sh
node scripts/check.mjs typecheck unit
```

Shortcuts: `npm run typecheck`, `npm run build`, `npm test` (the `unit` stage), `npm run test:host`,
`npm run test:pack` and `npm run lint` (the `forbidden` stage).

`TESTED_HOSTS` in `src/constants.ts` is the one list of tested OpenCode releases: 2.2.3, 2.2.4, 2.2.5 and 2.2.6. The host
and pack stages, status and CI all take their versions from it. Add a release there, and to the README's
requirements, when every check passes on it.

The host stage starts an embedded OpenCode host in a temporary home folder, with a local fake of Jira's MCP server and
sign-in server, once for each tested release. A request to any address other than the local machine fails the test.
2.2.3 is the locked `@opencode/sdk`; the stage installs the others from npm, outside this repository's lockfile, into a
temporary folder that it deletes afterwards (about 370 MB each, from npm's cache after the first run). To run the host
stage on one other OpenCode 2.2.x only, install that SDK in a separate folder and point `HOST_SDK_DIR` at it:

```sh
mkdir ../sdk-2.2.99 && cd ../sdk-2.2.99 && npm init -y && npm install @opencode/sdk@2.2.99 --ignore-scripts && cd -
HOST_SDK_DIR=../sdk-2.2.99 node scripts/check.mjs host
```

Every temporary folder of the host and pack stages is a git repository under the system's `/tmp`, never under
`TMPDIR` or your home folder. OpenCode looks for `.opencode` folders and project config upwards from a project, and
stops at a repository's root, so it never picks up your own agents or skills. Each stock server listens on its own
free port.

The pack stage needs network access to the npm registry. It checks that the tarball contains exactly the `files`
whitelist, with fewer than 30 entries and at most 100 KB; that `dist/` holds only `index.js` and `tui.js`, with no
relative import, dynamic `import()` or `require()`; and that they import only modules OpenCode provides. It
installs the tarball next to the host packages that OpenCode 2.2.3 provides and imports both entry points under Bun.
Then it installs the tarball alone and loads it with `opencode serve` from stock OpenCode 2.2.3, 2.2.4, 2.2.5 and 2.2.6. Each server
runs offline, in its own temporary home, on its own port with a password. The stage checks that every path in
`opencode debug paths` is inside that home, that the plugin is active, that the `jira` server and the default rules
are registered, that `/connect` lists the server as "Jira", and that the status RPC answers. It then points a
copy of the installed plugin at a local fake of Atlassian's server and calls the tools RPC as a script would.

To use `opencode` binaries you already have, set `OPENCODE_BIN_2_2_3` through `OPENCODE_BIN_2_2_6`:

```sh
OPENCODE_BIN_2_2_3=/path/to/opencode-2.2.3 OPENCODE_BIN_2_2_4=/path/to/opencode-2.2.4 \
  OPENCODE_BIN_2_2_5=/path/to/opencode-2.2.5 OPENCODE_BIN_2_2_6=/path/to/opencode-2.2.6 \
  node scripts/check.mjs pack
```

Otherwise the stage installs `@opencode/cli` with the binary for your platform (macOS or Linux, arm64 or x64), a few
hundred megabytes per version, once per run, into a temporary folder that it deletes afterwards.

CI (`.github/workflows/ci.yml`) runs `npm ci --ignore-scripts` and `npm run check` on Linux and macOS.

## Jira's tools

`src/jira-tools.ts` is the one record of the Jira tools the plugin knows: `READ_TOOLS`, `EXPORT_TOOLS`, `WRITE_TOOLS`
and `DESTRUCTIVE_TOOLS` give each tool its class, and `PARAMETERS` holds each tool's input parameters. The default rules
for every `access` value, the tools RPC's methods and classes, status's unknown and destructive tools, the fake server in
the host and pack tests, and the checks of `jelly.tools`, the docs and the skills all derive from it. Atlassian may add, rename or remove
tools without notice. It also loads only the tools a grant covers, so a known tool missing from one account's list is
not drift: `NOT_GRANTED_TOOLS` names the three this plugin's scope never grants.

The names and classes come from Atlassian's own list of its v2 MCP tools
([Supported tools](https://support.atlassian.com/atlassian-ai-gateway/docs/supported-tools/)), recorded in
`test/unit/live-tools.json`, a raw `tools/list` response. That page gives no input schemas or annotations, so
`PARAMETERS` is empty, and the skills name tools without their inputs: in Code Mode each call's signature gives the model
the parameter names. Once a tool list from a signed-in server is saved, reconciling is a data change, made with the drift
check below.

### Drift check

The drift check is a manual maintainer check. It is not part of `npm run check` or CI, nothing at runtime depends on
it, and it never calls Jira or reads a credential. **One form, one command.** A saved list is the server's own `tools/list` response: `{ "tools": [ { "name",
"description", "inputSchema"?, "annotations"? } ] }`, exactly as an MCP client prints it. Save it with the MCP
Inspector's CLI, which is the command this file names:

```sh
npx -y @modelcontextprotocol/inspector --cli "https://mcp.atlassian.com/v2/mcp?tools=all" \
  --method tools/list --header "Authorization: Bearer $ATLASSIAN_TOKEN" > tools-list.json
```

That is the one form this repository and the check accept; the fixture `test/unit/live-tools.json` is the same shape.
Keep a saved list out of this repository, except as that fixture.

**Check the shape first.** The list must be the flat one from `?tools=all`. If it holds `discover`, `executeRead`,
`executeWrite` or `executeDestructive`, the URL lost its query, and the check stops with exit code 2: the plugin's table
and every rule describe tools that never arrive, so re-save the list from the URL the plugin registers. Then:

```sh
npm run drift -- <tools.json>
npm run drift -- <tools.json> --strict
```

- It needs Node.js 22.18 or later, which loads `src/jira-tools.ts` by stripping its types. Keep that file free of
  runtime imports.
- It prints only tool names, parameter names and types, and annotations, grouped as added (listed, but in no list),
  removed (in a list, but not in the file; information only, since access differs), possibly renamed (a removed and an
  added tool that take mostly the same parameters), parameters changed (added, removed, now required or optional, or a
  new type), parameters to record (the file gives a known tool's input, which `PARAMETERS` doesn't have yet), change
  wording (a known read's description has a sentence in which the tool itself creates, changes or sends something;
  nouns, enum values, other tools' names and instructions to call another tool don't count), and, when the file has
  annotations, reclassified (the lists disagree with `readOnlyHint` or `destructiveHint`).
- What it can't see: OpenCode's tool list carries no annotations, so a tool that starts changing data shows only if
  its description says so. Read each new or changed description yourself.
- Exit codes: `0` for no drift, or drift without `--strict`; `1` for drift with `--strict`; `2` for a usage or file
  error.

`test/unit/live-tools.json` is the captured list, and two tests read it. The drift test runs the check on it with
`--strict`, so `src/jira-tools.ts` must match it exactly; `test/unit/live-tools.test.ts` names each difference the
reconcile has left: a name with no class, a class the table does not have, an effect the value does not give it, or a
deny that is not hidden. **Replacing that one file with a list from a signed-in server is the whole reconcile step**:
the tests and `npm run drift -- <saved.json> --strict` then name every name, class, effect or parameter the table,
`jelly.tools` or the skills do not cover. There is no count to update and no flag to clear.

### Updating the tool lists

1. Run the drift check.
2. For each name it reports, read the tool's description, schema and annotations, and check what it does.
3. Add a tool to `READ_TOOLS` only if it never changes anything and sends nothing to anyone. A tool that mints a
   credential, such as a signed download URL, goes to `EXPORT_TOOLS`. Add tools that change anything to `WRITE_TOOLS`.
   A tool that deletes permanently, changes a project, screen or workflow setting, changes who can see an item, writes
   an entity property, or touches users goes to `DESTRUCTIVE_TOOLS`. Leave a tool out if you are not sure: it then has
   no class, runs under the namespace pattern alone, and scripts cannot call it.
4. Update `PARAMETERS` from the schemas, `jelly.tools` in `package.json`, and any skill text that names a changed tool.
   With parameters recorded, a skill may give a literal call such as `getJiraIssue({ … })`, and the skills test checks
   its keys against `PARAMETERS`. Run `npm run check`: the Jelly test fails if `jelly.tools` differs from the lists, the
   skills test if a skill names a tool or parameter the record doesn't have, and the docs test if a doc names a tool in
   no list.
5. Record the change in `CHANGELOG.md`. Moving a tool between the lists changes the default rules and the tools RPC's
   methods, which are part of the plugin's contract.

## Commits

Use `type(scope): summary`, for example `fix(status): explain a disabled server`. Keep commits small, and keep
`npm run check` green.

## Releases

### Versioning

The version follows semantic versioning on the plugin's contract: its options, the `/jira-status` command, the
`/jira` dialog, the skill names, the server name `jira` and its URL, the status RPC method, the tools RPC's
methods and the default rule behaviour. While the major version is 0, a breaking change raises the minor version, and
anything else the patch version.

Each release supports one tested OpenCode line, stated as `opencode.host` in `package.json` and enforced by the host
check (`SUPPORTED_HOST` in `src/constants.ts`). Both must change together, with the README's requirements. Each
`CHANGELOG.md` entry follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

### Releasing

1. Update `version` in `package.json` and add the `CHANGELOG.md` entry, then run `npm run check`.
2. Push the release commit to `master` and tag it `v<version>`. The release workflow refuses a
   private package or a tag that differs from `version`.
3. Approve the run in the GitHub environment `release`.

CI then runs `npm run check`, packs the tree, runs the pack test against that exact tarball
(`PACK_TARBALL=<tarball> node scripts/check.mjs pack`), and publishes it with npm trusted publishing and provenance:
`npm publish <tarball> --provenance --access public`. The trusted publisher on npmjs.com names this repository, the
workflow `release.yml` and the environment `release`, and allows `npm publish`. A rerun skips a version that is
already on npm.

### Dist-tags

- `latest`: the newest stable release. The release workflow sets it for versions without a prerelease part.
- `next`: prereleases, such as `<version>-rc.1`. The release workflow sets it.
- `host-2.2`: the newest release for OpenCode 2.2.x. Move it by hand, so users on 2.2 can still install a matching
  version after `latest` moves to a newer OpenCode line:

  ```sh
  npm dist-tag add @joe-broadhead/opencode-jira@<version> host-2.2
  ```

Never unpublish a release. Deprecate it instead, and name the version to use:

```sh
npm deprecate @joe-broadhead/opencode-jira@<version> "<reason>. Use <version> instead."
```
