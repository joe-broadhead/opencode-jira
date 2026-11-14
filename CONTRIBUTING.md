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
| `copies` | `node scripts/check-copies.mjs`: the tools RPC's shared part in `src/host/tools-rpc.ts`, outside its `PLUGIN-SPECIFIC` block, and Jelly's setting rules in `test/support/jelly-settings.ts` match the copies every plugin carries |
| `lint:actions` | `actionlint` over the workflows, when it is on PATH; CI runs it as its own job |
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

Each release is the GitHub tag `v<version>`, where `<version>` is the `version` in `package.json`, and users install from
that tag. The release is one commit on top of a `master` head that CI passed, and the tag points at it. The release
workflow makes both, in GitHub Actions: nobody builds, commits or tags a release on their own machine, and no personal
key signs it.

While changes land, their notes go under `## [Unreleased]` at the top of `CHANGELOG.md`. Each earlier GitHub release is
a `## [x.y.z] - YYYY-MM-DD` heading below it, newest first, and the npm history stays last, under
`## Earlier releases on npm`.

1. On `master`, set `version` in `package.json` to the new version, and change every install spec in the README,
   `CONTRIBUTING.md` and `docs/` to `#v<version>` (`test/docs.test.ts` fails until they match). Then run
   `node scripts/changelog.mjs release`: it turns `## [Unreleased]` into `## [<version>] - <today>`, above the earlier
   releases, and refuses a CHANGELOG it cannot shape. Run `npm run check`.
2. Push that commit to `master`, and wait for CI to pass on it.
3. Start the release with that commit's full sha:
   `gh workflow run release.yml --ref master -f sha=<full sha>`, or from Actions → release →
   Run workflow, on `master`.
4. Read the run's summary, then approve the `release` environment. The summary is on the run page, under the `stage`
   job: the tag, the parent and its CI run, the release commit and its tree, the sha256 of `SHA256SUMS` and the staged
   artifact's id, `SHA256SUMS` itself, and the notes. Open the release commit on `release/v<version>` and read them
   before approving: the approval releases exactly those bytes. Only the owner approves a release. Agents never approve
   one, never call the deployment-approval API, and never bypass a ruleset or the environment; the kit's scripts make
   only their own GitHub calls and refuse every other.
5. Check the published Release: not a draft, its notes, and every asset against `SHA256SUMS`.

`package.json` stays `"private": true`, so npm can never publish the plugin by accident; a GitHub install does not read
it, and `npm pack` still packs the release tarball. It is kept in its canonical form, `JSON.stringify(pkg, null, 2)` and
one newline: the kit tests check both in `npm run check`, as the release planner does.

Before the approval, the workflow:
- **plans:** refuses a run that is not on `master`, a sha that is not `master`'s head, a sha without a successful
  `ci.yml` push run, a version that is not `x.y.z`, a `package.json` that is not `"private": true` or not in its
  canonical form, a CHANGELOG whose newest release is not this version, a release that does not move forward from the
  last published Release, a leftover `release/v<version>` branch, a native run that did not build this sha on `master`,
  by hand, with success, and a missing `native_run` (or one given to a plugin that is not native);
- **builds** `dist/` with `npm ci --ignore-scripts` and `npm run build`, with a read-only token, and writes the release
  files: `dist/`, `package.json` without its lifecycle scripts, and the vetted native manifest;
- **commits** them on a temporary branch `release/v<version>` at the parent, through GitHub's API with the workflow's token,
  so GitHub signs the commit (author `github-actions[bot]`, committer GitHub). This job runs no npm. It refuses a commit
  that GitHub does not verify, or whose parent or tree is not the one the files give;
- **verifies** on a fresh runner: the commit's identity, one parent on `master`, `package.json` exactly the parent's
  without the lifecycle scripts, only regular files in the allowed paths, no `package.json` under `dist/`, and a second,
  independent build of the parent (its own job) equal to the committed `dist/` byte for byte;
- **installs** the release commit with `plugin add` on each stock OpenCode host (2.2.3 to 2.2.6);
- **packs** the commit before installing anything and keeps that tarball, then runs the pack stage against a copy;
- **stages** the Release: verifies the attested native files, writes `SHA256SUMS` and the notes (the version's CHANGELOG
  section), and shows them all in the run summary with the sha256 of `SHA256SUMS`.

A job either runs repository or dependency code (`npm ci`, the build, the pack stage, a host install) and has no write
token, or uses the API and runs only the kit's scripts on a fresh checkout, after checking that the release commit's
`scripts/` and `.github/` are the parent's. The first kind is not token-free: `actions/checkout` fetches with the job's
read-only (`contents: read`) token, and its post step and the artifact uploads run after repository code on the same
runner, so that code could reach a read-only token for this public repository and the runner's artifact token. Jobs
pass files as artifacts downloaded by the id the uploading job gave, and each is checked again on arrival.

After the approval, it downloads the staged artifact by the id the summary names, and refuses unless `SHA256SUMS` has
the sha256 the summary shows and every staged file matches it, and every native file is the one the release commit's
`manifest/native.json` pins, size and sha256, with each gzip holding the pinned executable. Then it checks everything again, creates the annotated tag
`v<version>` on the release commit (tagger `github-actions[bot]`, unsigned), checks the tag, creates the Release with the
notes, the tarball, the native files and `SHA256SUMS`, and deletes `release/v<version>`. The tag keeps the commit.

GitHub's signature and the bot identity show only that GitHub made the commit through its API for the workflow; anyone
with write access can make such a commit. What ties the release to `master` is its content: one parent CI passed, the
exact `package.json`, the allowed paths and the byte-for-byte rebuild. Never relax those because the commit is signed.

**A rejected, expired or failed run** leaves nothing behind: the `cleanup` job deletes `release/v<version>` when it points
at the parent or at that run's commit, and never touches another branch. No tag exists before the approval, so the
version is not burned: fix `master` and start again. If `cleanup` itself failed, the next run refuses until the branch
is deleted: `gh api -X DELETE repos/joe-broadhead/opencode-jira/git/refs/heads/release/v<version>`.

**Resume.** If the run fails after creating the tag and before the Release is complete, start it again with the same `sha`. The plan finds the kit's tag on a release commit on that sha with no published Release, and resumes:
it makes no new commit, checks and installs the tagged commit, stages the files, and after a new approval reuses the tag
and adds what the Release lacks. Delete a draft Release a failed upload left first: the publish step refuses a draft.
Any other existing tag is refused: release the next version.

The repository's tag ruleset keeps a `v*` tag from being moved or deleted. A stray `v*` tag, one that never became a
Release, does not block later releases: only published Releases count, and drafts do not. Its version cannot be
released, so release the next one. To remove the tag anyway, an admin disables the `release tags` ruleset, deletes the
tag, and restores the ruleset exactly as it was.

**Known limit: a `v*` tag pushed by hand.** No ruleset limits who creates a `v*` tag, so anyone with write access can
push one by hand, pointing at any commit. Such a tag has no published Release, the forward-only check ignores it, and
Jelly installs only a published Release whose `SHA256SUMS` it verifies. But a user who installs
`github:joe-broadhead/opencode-jira#v<x>` directly gets whatever that tag points at. Only the release workflow makes
release tags; never push one by hand.

The release kit is these files, the same in every plugin: `scripts/release-rules.mjs`, `scripts/release-commit.mjs`,
`scripts/release-github.mjs`, `scripts/check-release-shape.mjs`, `scripts/changelog.mjs`, `scripts/release-version.mjs`,
`scripts/release-pack.mjs`, `scripts/publish-release.mjs`, `scripts/attach-native.mjs`, `scripts/native-manifest.mjs`,
`scripts/tested-hosts.mjs`, `scripts/check-release-plugin-add.sh`, `scripts/release-kit.test.mjs` and
`.github/workflows/release.yml`. Do not re-run the older `apply-release-kit.mjs`: it writes back the kit that could
release only `v0.0.0`.

Each release has its own tag, and a Git install does not update by itself. To move to a newer release, remove the old entry with `opencode plugin remove github:joe-broadhead/opencode-jira#v<old version>`, then add the new tag with `opencode plugin add github:joe-broadhead/opencode-jira#v<version>`.

Or add the plugin to `opencode.json` instead, with the same spec:

```json
{ "plugins": [{ "package": "github:joe-broadhead/opencode-jira#v0.0.2" }] }
```
