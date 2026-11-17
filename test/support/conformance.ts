// source-contract's conformance kit, run over this plugin's own reads for jira.activity (events_list and probe, as setup
// registers them) against Atlassian's answers from test/fixtures/conformance.json. No live call is made. Each read runs
// in the kit's recording permission: the plugin's own asserts go to it, and so does every Jira tool the fake host's
// executor runs (`jira_<tool>`, as OpenCode's executor asserts it), so declared must equal asserted.
// `npm run conformance` writes the report (reports/conformance-report.json); test/unit/conformance.test.ts asserts it.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { sourceConformance, type ConformanceReport, type SessionContext, type ToolDeclaration } from "@we-the-rebel-alliance/source-contract/conformance"
import { encodeBoundCursor } from "@we-the-rebel-alliance/source-contract/cursor"
import { readInstalledDescriptor, type InstalledDescriptor } from "@we-the-rebel-alliance/source-contract/descriptor"
import { SOURCES_SCHEMA } from "@we-the-rebel-alliance/source-contract/schema"
import type { ToolCall } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { accountOf, bindingOf, eventsMethod, jiraTime, JIRA_SOURCE, PACKAGE, probeMethod, signIns, type EventsOptions, type SignIns } from "../../src/events.js"
import { METHODS } from "../../src/tools-rpc.js"

export const ROOT = join(import.meta.dir, "..", "..")

export interface Fixture {
  readonly now: string
  readonly me: Record<string, unknown>
  readonly resources: readonly Record<string, unknown>[]
  readonly issues: Readonly<Record<string, readonly { id: string; key: string; fields: Record<string, unknown> }[]>>
}

export const FIXTURE = JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "conformance.json"), "utf8")) as Fixture

/** The minutes a search's `updated >= "-<n>m"` names. */
export const windowMinutes = (jql: string) => Number(/updated >= "-(\d+)m"/.exec(jql)?.[1] ?? Number.NaN)

/**
 * Atlassian's answer to searchJiraIssuesUsingJql: the site's work items updated in the window, oldest update first
 * (then by key number), `maxResults` at a time, with a `nextPageToken` while there are more.
 */
export function searchAnswer(fixture: Fixture, input: Record<string, unknown>) {
  const now = Date.parse(fixture.now)
  const from = now - windowMinutes(String(input["jql"])) * 60_000
  const all = (fixture.issues[String(input["cloudId"])] ?? [])
    .filter((issue) => jiraTime(issue.fields["updated"])! >= from)
    .sort((a, b) => jiraTime(a.fields["updated"])! - jiraTime(b.fields["updated"])! || Number(a.key.split("-")[1]) - Number(b.key.split("-")[1]))
  const offset = Number(input["nextPageToken"] ?? 0)
  const size = Number(input["maxResults"] ?? 50)
  const issues = all.slice(offset, offset + size)
  const last = offset + size >= all.length
  return { issues, isLast: last, ...(last ? {} : { nextPageToken: String(offset + size) }), appliedContentFormat: "markdown" }
}

/** Atlassian's answer to each tool the source reads, as the MCP server's text. */
export function answers(fixture: Fixture): Record<string, (input: Record<string, unknown>) => unknown> {
  return {
    atlassianUserInfo: () => fixture.me,
    getAccessibleAtlassianResources: () => ({ resources: fixture.resources }),
    searchJiraIssuesUsingJql: (input) => searchAnswer(fixture, input),
  }
}

/**
 * The plugin's source options for one kit call: the fake host's executors answer from the fixture and assert
 * `jira_<tool>` in the kit's session first, as OpenCode's executor does; the plugin's own asserts go there too.
 */
export function sourceOptions(fixture: Fixture, context: Pick<SessionContext, "permission">, calls: string[] = [], known: SignIns = signIns()): EventsOptions {
  const tools = Object.entries(answers(fixture)).map(([tool, answer]) => ({
    id: `jira_${tool}`,
    execute: async (input: Record<string, unknown>) => {
      // OpenCode's executor asserts the tool's own action before it calls Atlassian.
      await context.permission.assert({ action: `jira_${tool}`, resources: ["*"] })
      calls.push(tool)
      return { content: [{ type: "text", text: JSON.stringify(answer(input)) }] }
    },
  }))
  return {
    tool: { list: async () => tools as never },
    mcp: { list: async () => ({ data: [{ name: "jira", status: { status: "connected" } }] }) as never },
    permission: { assert: async (input) => context.permission.assert({ action: input.action, resources: [...input.resources] }) },
    owned: () => true,
    signIn: async () => "cred_conformance",
    signIns: known,
    now: () => Date.parse(fixture.now),
  }
}

export const call = (): ToolCall => ({ sessionID: "ses_conformance", agent: "build", messageID: "msg_conformance", id: "call_conformance", signal: new AbortController().signal, progress: async () => {} })

/** The plugin's tools RPC methods, as describe lists them: the tools a source may name, each read-only or not. */
export function declaredTools(): ToolDeclaration[] {
  const options = sourceOptions(FIXTURE, { permission: { assert: async () => {} } })
  return [...METHODS, eventsMethod(options), probeMethod(options)].map((method) => ({ id: method.name, readOnly: method.class === "read" }))
}

/** The repository's package.json, read as a consumer reads an installed plugin: checked, then hashed. */
export function installed(): InstalledDescriptor {
  const checked = readInstalledDescriptor(ROOT)
  if (!checked.ok) throw new Error(`package.json's sources: ${checked.problems.join("; ")}`)
  return checked.value
}

/** package.json's sources, as Memory's schema parses them for the kit. */
export function declaredSources() {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { sources: unknown }
  const checked = SOURCES_SCHEMA.check(pkg.sources)
  if (!checked.ok) throw new Error(`package.json's sources: ${checked.problems.join("; ")}`)
  return checked.value
}

/** The kit's report for every declared source. */
export async function conformanceReports(fixture: Fixture = FIXTURE): Promise<ConformanceReport[]> {
  // Read as a consumer reads it first (the frame, checked and hashed), then as the kit reads it (Memory's schema).
  installed()
  const sources = declaredSources()
  const account = accountOf(String(fixture.me["accountId"]))
  // What probe records, for the one sign-in: a listing checks its account against it, as the plugin does.
  const known = signIns()
  const methods = (session: Pick<SessionContext, "permission">) => {
    const options = sourceOptions(fixture, session, [], known)
    return { events: eventsMethod(options), probe: probeMethod(options) }
  }
  // A consumer probes at bind: the plugin then knows who the sign-in is, and a listing for that account runs.
  await methods({ permission: { assert: async () => {} } }).probe.run({ source: JIRA_SOURCE }, call())
  const reports: ConformanceReport[] = []
  for (const source of sources.items) {
    if (source.id !== "jira.activity") throw new Error(`${source.id} is declared and the conformance run has no calls for it`)
    reports.push(
      await sourceConformance({
        plugin: PACKAGE,
        source,
        tools: declaredTools(),
        account,
        sources: { rpc: sources.rpc, probe: sources.probe },
        describe: { id: sources.rpc },
        atomicPages: {
          reason:
            "a listing is one getAccessibleAtlassianResources call and searchJiraIssuesUsingJql pages, each answered whole in one call; any of them failing fails the whole events_list, so no single work item can fail on its own",
        },
        noExpiry: {
          reason: "a cursor holds an update time and a work item id per site, and JQL reads any past update time, so a Jira cursor never expires",
        },
        calls: {
          list: (input, session) => methods(session).events.run(input, call()),
          probe: (input, session) => methods(session).probe.run(input, call()),
        },
        cases: [
          { name: "the work items changed since a day, two in the same millisecond, with one that holds a secret refused", input: { source: JIRA_SOURCE, since: "2026-11-12T00:00:00Z" } },
          { name: "the oldest change, then more", input: { since: "2026-11-12T00:00:00Z", limit: 1 } },
          { name: "the signed-in account named", input: { account, since: "2026-11-12T00:00:00Z", limit: 2 } },
          { name: "an empty page still carries a cursor", input: { source: JIRA_SOURCE, since: "2026-11-13T11:00:00Z" }, expect: "empty" },
          { name: "another account is refused", input: { account: "5b10ac8d82e05b22cc7d4ef5" }, expect: { refuses: "ACCOUNT_MISMATCH" } },
          {
            name: "another account's cursor is refused",
            input: { cursor: encodeBoundCursor(bindingOf("5b10ac8d82e05b22cc7d4ef5"), { a: "5b10ac8d82e05b22cc7d4ef5", f: 0, p: {} }) },
            expect: { refuses: "ACCOUNT_MISMATCH" },
          },
          { name: "a cursor of another source is refused", input: { cursor: encodeBoundCursor({ plugin: "linear", source: "linear", account }, { a: account, f: 0, p: {} }) }, expect: { refuses: "CURSOR_INVALID" } },
          { name: "another source is refused", input: { source: "linear" }, expect: { refuses: "SOURCE_UNKNOWN" } },
        ],
      }),
    )
  }
  return reports
}
