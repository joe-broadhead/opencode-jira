// jira.activity: events_list and probe against Atlassian's answers, offline. The conformance kit runs the same reads in
// test/support/conformance.ts; these tests pin the cursor, the paging, the sites and every refusal.
import { beforeEach, describe, expect, test } from "bun:test"
import { encodeBoundCursor, encodeCursor } from "@we-the-rebel-alliance/source-contract/cursor"
import { EVENTS_LIST, PROBE, resultProblems } from "@we-the-rebel-alliance/source-contract/events"
import {
  accountOf,
  bindingOf,
  eventsMethod,
  INVOLVES,
  jiraEvents,
  jiraProbe,
  jiraTime,
  MAX_SITES,
  probeMethod,
  reader,
  SEARCH_PAGE,
  SEARCH_PAGES,
  SETTLE_MS,
  signedInOf,
  signIns,
  sitesOf,
  type EventsOptions,
  type Read,
} from "../../src/events.js"
import { EVENTS_TOOL, PROBE_METHOD } from "../../src/jira-tools.js"
import { pluginError } from "../../src/tools-rpc.js"
import { call, conformanceReports, FIXTURE, searchAnswer, sourceOptions, windowMinutes, type Fixture } from "../support/conformance.js"

const NOW = Date.parse(FIXTURE.now)
const ME = String(FIXTURE.me["accountId"])
const ACCOUNT = accountOf(ME)
const SITE = "11111111-2222-4333-8444-555555555555"
const OTHER_SITE = "22222222-2222-4333-8444-555555555555"
/** Who probe named for the sign-in. */
const SIGNED = signedInOf(FIXTURE.me)

type Issue = Fixture["issues"][string][number]

const issue = (id: number, updated: string, summary = `Work item ${id}`): Issue => ({
  id: String(id),
  key: `EX-${id}`,
  fields: { summary, updated, assignee: { accountId: ME, displayName: "Pilot Owner", emailAddress: "pilot@example.com" }, status: { name: "To Do", statusCategory: { name: "To Do" } }, issuetype: { name: "Task" } },
})

/** A fixture with other work items, and the reads it answers, recorded. */
/** Atlassian's clock, which the fake's `updated >= "-<n>m"` counts back from: a test that reads at another time sets it. */
const clock = { now: FIXTURE.now }

function fake(issues: Fixture["issues"] = FIXTURE.issues, resources = FIXTURE.resources) {
  const fixture: Fixture = { ...FIXTURE, issues, resources }
  const calls: { tool: string; input: Record<string, unknown> }[] = []
  const read: Read = async (tool, input) => {
    calls.push({ tool, input })
    if (tool === "atlassianUserInfo") return { data: fixture.me }
    if (tool === "getAccessibleAtlassianResources") return { data: { resources: fixture.resources } }
    if (tool === "searchJiraIssuesUsingJql") return { data: searchAnswer({ ...fixture, now: clock.now }, input) }
    throw new Error(`unexpected ${tool}`)
  }
  return { read, calls, searches: () => calls.filter((entry) => entry.tool === "searchJiraIssuesUsingJql") }
}

/** Every event and refusal a listing gives, page by page from `input`, and the pages it took. */
async function drain(read: Read, input: Record<string, unknown>, now = NOW) {
  clock.now = new Date(now).toISOString()
  const titles: string[] = []
  const gaps: unknown[] = []
  let page = await jiraEvents(read, SIGNED, input, now)
  let pages = 1
  for (;;) {
    expect(resultProblems(page, typeof input["limit"] === "number" ? input["limit"] : 500, 65_536)).toEqual([])
    titles.push(...page.events.map((event) => event.title), ...(page.refused ?? []).map((entry) => `refused ${entry.external_id}`))
    if (page.gap) gaps.push(page.gap)
    if (!page.more) return { titles, cursor: page.cursor, pages, gaps }
    page = await jiraEvents(read, SIGNED, { ...input, since: undefined, cursor: page.cursor }, now)
    pages++
  }
}

describe("the contract's names", () => {
  test("events_list and probe are the contract's method names", () => {
    expect(EVENTS_TOOL).toBe(EVENTS_LIST)
    expect(PROBE_METHOD).toBe(PROBE)
  })
})

describe("events_list", () => {
  beforeEach(() => void (clock.now = FIXTURE.now))
  test("lists each work item the person is part of once per update, oldest first, as metadata only", async () => {
    const { read, searches, calls } = fake()
    const page = await jiraEvents(read, SIGNED, { since: "2026-11-12T00:00:00Z" }, NOW)
    expect(page.events.map((event) => event.title)).toEqual(["EX-1: Plan the queue migration", "EX-2: Review the release notes", "EX-10: Fix the flaky sign-in test"])
    expect(page).toMatchObject({ source: "jira", account: ACCOUNT, owner: { id: `atlassian:${ME}`, label: ME }, more: false, trust: "untrusted", plugin: "@joe-broadhead/opencode-jira" })
    const [first] = page.events
    expect(first).toMatchObject({
      external_id: `${SITE}/10001@2026-11-12T08:00:00.120Z`,
      kind: "issue",
      occurred_at: "2026-11-12T08:00:00.120Z",
      thread: `jira-issue:${SITE}/10001`,
      text: "Status: In Progress. Type: Task. Priority: Medium.",
      url: "https://example.atlassian.net/browse/EX-1",
      labels: ["type:task", "status:in-progress"],
    })
    expect(first!.actors).toEqual([
      { role: "assignee", id: `atlassian:${ME}`, name: "Pilot Owner" },
      { role: "reporter", id: "atlassian:5b10ac8d82e05b22cc7d4ef5", name: "Ama Mensah" },
    ])
    // The secret-holding summary is refused for good; the work item updated within the settle time waits.
    expect(page.refused).toEqual([{ external_id: `${SITE}/10003@2026-11-12T10:00:00.000Z`, reason: "secret", detail: expect.any(String) }])
    expect(JSON.stringify(page)).not.toContain("Qv7mZr2pLx9T")
    expect(JSON.stringify(page)).not.toContain("EX-4")
    // Only the Jira site is searched, for the person's own work items, in minutes before now, oldest first.
    expect(searches().map((entry) => entry.input["cloudId"])).toEqual([SITE])
    // The listing reads the sites and searches; who is signed in is probe's read alone.
    expect(calls.map((entry) => entry.tool)).toEqual(["getAccessibleAtlassianResources", "searchJiraIssuesUsingJql"])
    const jql = String(searches()[0]!.input["jql"])
    expect(jql.startsWith(`${INVOLVES} AND updated >= "-`)).toBe(true)
    expect(jql.endsWith(" ORDER BY updated ASC, key ASC")).toBe(true)
    expect(searches()[0]!.input).toMatchObject({ maxResults: 100, view: "evidence", fields: ["summary", "updated", "assignee", "reporter", "status", "issuetype", "priority"] })
  })

  test("never carries a description, a comment or an email address", async () => {
    const withBody = { ...issue(7, "2026-11-12T11:00:00.000+0000"), fields: { ...issue(7, "2026-11-12T11:00:00.000+0000").fields, description: "Customer Acme's outage", comment: { comments: [{ body: "internal note" }] } } }
    const { read } = fake({ [SITE]: [withBody] })
    const text = JSON.stringify(await jiraEvents(read, SIGNED, { since: "2026-11-12T00:00:00Z" }, NOW))
    for (const word of ["Acme", "internal note", "pilot@example.com"]) expect(text).not.toContain(word)
  })

  test("opens the search a few minutes before the cursor, in minutes before now, whatever the person's time zone", async () => {
    const { read, searches } = fake()
    await jiraEvents(read, SIGNED, { since: "2026-11-13T11:00:00Z" }, NOW)
    // 60 minutes since, and 2 minutes for the two clocks.
    expect(windowMinutes(String(searches()[0]!.input["jql"]))).toBe(62)
  })

  test("pages by its cursor with no repeat and no gap, two work items updated in the same millisecond included", async () => {
    const { read } = fake()
    const all = await drain(read, { since: "2026-11-12T00:00:00Z", limit: 1 })
    expect(all.titles).toEqual(["EX-1: Plan the queue migration", "EX-2: Review the release notes", "EX-10: Fix the flaky sign-in test", `refused ${SITE}/10003@2026-11-12T10:00:00.000Z`])
    expect(all.pages).toBe(3)
    // The last cursor lists nothing more, until a work item changes again.
    expect((await jiraEvents(read, SIGNED, { cursor: all.cursor }, NOW)).events).toEqual([])
  })

  test("lists a work item again when it is updated again, with a new id, and nothing it listed before", async () => {
    const { read } = fake()
    const first = await jiraEvents(read, SIGNED, { since: "2026-11-12T00:00:00Z" }, NOW)
    const later = NOW + 3_600_000
    const updated = { ...FIXTURE.issues[SITE]![0]!, fields: { ...FIXTURE.issues[SITE]![0]!.fields, updated: "2026-11-13T12:10:00.000+0000" } }
    const again = fake({ [SITE]: [...FIXTURE.issues[SITE]!.slice(1), updated] })
    clock.now = new Date(later).toISOString()
    const page = await jiraEvents(again.read, SIGNED, { cursor: first.cursor }, later)
    expect(page.events.map((event) => event.external_id)).toEqual([`${SITE}/10004@2026-11-13T11:58:00.000Z`, `${SITE}/10001@2026-11-13T12:10:00.000Z`])
  })

  test("reads the search's next pages, and stops before an update time a later page may still hold", async () => {
    // 250 work items, 120 of them in one second: more than one search page, and a page that ends inside a second.
    const items = Array.from({ length: 250 }, (_, index) => issue(1000 + index, index < 120 ? "2026-11-12T10:00:00.000+0000" : `2026-11-12T11:${String(Math.floor((index - 120) / 3)).padStart(2, "0")}:00.000+0000`))
    const { read, searches } = fake({ [SITE]: items })
    const first = await jiraEvents(read, SIGNED, { since: "2026-11-12T00:00:00Z", limit: 50 }, NOW)
    // The first search page ends in the second the 120 share: the next page is read before any of them is listed.
    expect(searches().map((entry) => entry.input["nextPageToken"])).toEqual([undefined, "100"])
    expect(first.events).toHaveLength(50)
    expect(first.more).toBe(true)
    const all = await drain(read, { since: "2026-11-12T00:00:00Z", limit: 50 })
    expect(all.titles).toEqual(items.map((item) => `${item.key}: ${item.fields["summary"]}`))
  })

  test("an empty page still carries a cursor that reads on", async () => {
    const { read } = fake()
    const page = await jiraEvents(read, SIGNED, { since: "2026-11-13T11:00:00Z" }, NOW)
    expect(page).toMatchObject({ events: [], more: false })
    // EX-4, updated at 11:58, is listed once it has settled.
    clock.now = new Date(Date.parse("2026-11-13T11:58:00Z") + SETTLE_MS).toISOString()
    const later = await jiraEvents(read, SIGNED, { cursor: page.cursor }, Date.parse(clock.now))
    expect(later.events.map((event) => event.title)).toEqual(["EX-4: Write the onboarding guide"])
  })

  test("a cursor never expires: one a year old reads on, with no gap", async () => {
    const { read } = fake()
    const old = encodeBoundCursor(bindingOf(ACCOUNT), { a: ACCOUNT, f: NOW - 365 * 86_400_000, p: { [SITE]: [NOW - 365 * 86_400_000, "1"] } })
    const page = await jiraEvents(read, SIGNED, { cursor: old }, NOW)
    expect(page.gap).toBeUndefined()
    expect(page.events[0]!.title).toBe("EX-5: Archive the old dashboards")
  })

  test("refuses a cursor it did not issue for this account, before any search", async () => {
    const { read, searches } = fake()
    const refusal = (input: Record<string, unknown>) => jiraEvents(read, SIGNED, input, NOW).then(() => "answered", (error: Error) => error.message)
    // An earlier cursor version, another source's, a broken one, and one with a bad position.
    expect(await refusal({ cursor: encodeCursor("jira", { a: ACCOUNT }) })).toStartWith("CURSOR_INVALID: ")
    expect(await refusal({ cursor: encodeBoundCursor({ plugin: "linear", source: "linear", account: ACCOUNT }, { a: ACCOUNT, f: 0, p: {} }) })).toStartWith("CURSOR_INVALID: ")
    expect(await refusal({ cursor: "not-a-cursor" })).toStartWith("CURSOR_INVALID: ")
    expect(await refusal({ cursor: encodeBoundCursor(bindingOf(ACCOUNT), { a: ACCOUNT, f: 0, p: { [SITE]: ["x", "1"] } }) })).toStartWith("CURSOR_INVALID: ")
    // Another account's cursor names that account.
    expect(await refusal({ cursor: encodeBoundCursor(bindingOf("someone"), { a: "someone", f: 0, p: {} }) })).toStartWith("ACCOUNT_MISMATCH: The cursor is for another Atlassian account")
    expect(searches()).toEqual([])
  })

  test("never asks who is signed in: without a probe it waits for one, and it refuses another account before any read", async () => {
    const { read, calls } = fake()
    await expect(jiraEvents(read, undefined, { since: "2026-11-12T00:00:00Z" }, NOW)).rejects.toThrow(/^UNAVAILABLE: The plugin does not know yet who is signed in to Jira.*Next step: Call probe for the jira source/)
    await expect(jiraEvents(read, SIGNED, { account: "someone" }, NOW)).rejects.toThrow(/^ACCOUNT_MISMATCH: Jira is signed in to another Atlassian account than "someone"/)
    expect(calls).toEqual([])
    const cursor = encodeBoundCursor(bindingOf(ACCOUNT), { a: ACCOUNT, f: 0, p: {} })
    await expect(jiraEvents(read, SIGNED, { account: "someone", cursor }, NOW)).rejects.toThrow(/^ACCOUNT_MISMATCH: The cursor is for another Atlassian account/)
    expect(calls).toEqual([])
    expect((await jiraEvents(read, SIGNED, { account: ACCOUNT, since: "2026-11-12T00:00:00Z" }, NOW)).account).toBe(ACCOUNT)
  })

  test("refuses an invalid input and another source with the contract's codes", async () => {
    const { read, calls } = fake()
    await expect(jiraEvents(read, SIGNED, { limit: 0 }, NOW)).rejects.toThrow(/^INPUT_INVALID: /)
    await expect(jiraEvents(read, SIGNED, { scope: { project: ["EX"] } }, NOW)).rejects.toThrow(/^INPUT_INVALID: /)
    await expect(jiraEvents(read, SIGNED, { source: "linear" }, NOW)).rejects.toThrow(/^SOURCE_UNKNOWN: /)
    expect(calls).toEqual([])
  })

  test("follows every Jira site the sign-in reaches, each with its own position, and skips a Confluence-only one", async () => {
    const resources = [...FIXTURE.resources, { cloudId: OTHER_SITE, url: "https://other.atlassian.net", products: [{ id: "jira-software" }] }]
    const issues = { [SITE]: FIXTURE.issues[SITE]!, [OTHER_SITE]: [issue(20, "2026-11-12T09:15:00.000+0000", "Other site work")] }
    const { read, searches } = fake(issues, resources)
    const all = await drain(read, { since: "2026-11-12T00:00:00Z", limit: 2 })
    expect(all.titles).toEqual(["EX-1: Plan the queue migration", "EX-20: Other site work", "EX-2: Review the release notes", "EX-10: Fix the flaky sign-in test", `refused ${SITE}/10003@2026-11-12T10:00:00.000Z`])
    expect(new Set(searches().map((entry) => entry.input["cloudId"]))).toEqual(new Set([SITE, OTHER_SITE]))
  })

  test("a site that cannot be read whole yet holds back the other sites' later changes, so the pages stay oldest first", async () => {
    const busy = Array.from({ length: 150 }, (_, index) => issue(3000 + index, `2026-11-12T10:${String(Math.floor(index / 3)).padStart(2, "0")}:00.000+0000`))
    const issues = { [SITE]: busy, [OTHER_SITE]: [issue(20, "2026-11-12T09:00:00.000+0000", "Early"), issue(21, "2026-11-12T11:30:00.000+0000", "Late")] }
    const resources = [FIXTURE.resources[0]!, { cloudId: OTHER_SITE, url: "https://other.atlassian.net" }]
    const { read } = fake(issues, resources)
    const first = await jiraEvents(read, SIGNED, { since: "2026-11-12T00:00:00Z", limit: 120 }, NOW)
    expect(first.events.map((event) => event.title)).not.toContain("EX-21: Late")
    expect(first.more).toBe(true)
    const all = await drain(read, { since: "2026-11-12T00:00:00Z", limit: 120 })
    const times = all.titles.map((title) => title)
    expect(times[0]).toBe("EX-20: Early")
    expect(times.at(-1)).toBe("EX-21: Late")
    expect(times).toHaveLength(152)
  })

  /** `count` work items of the person's, updated `stepMs` apart from `start`. */
  const burst = (count: number, start: string, stepMs: number, first = 50_000) =>
    Array.from({ length: count }, (_, index) => issue(first + index, new Date(Date.parse(start) + index * stepMs).toISOString().replace("Z", "+0000")))
  const titlesOf = (items: Issue[]) => items.map((item) => `${item.key}: ${item.fields["summary"]}`)

  test.each([
    [1200, 50],
    [5000, 12],
  ])("drains %i work items updated within one minute, across calls, with no repeat, skip, gap or failure", async (count, stepMs) => {
    const items = burst(count, "2026-11-12T10:00:00.000Z", stepMs)
    const { read, searches } = fake({ [SITE]: items })
    const all = await drain(read, { since: "2026-11-12T00:00:00Z", limit: 100 })
    expect(all.titles).toEqual(titlesOf(items))
    expect(all.gaps).toEqual([])
    expect(all.pages).toBeLessThanOrEqual(count / 100 + 1)
    // A call walks past what it listed before with the token, never more than SEARCH_PAGES pages.
    expect(searches().length).toBeLessThanOrEqual(all.pages * SEARCH_PAGES)
  }, 60_000)

  test("a burst that straddles two reads: what settled is listed first, the rest on a later read, once each", async () => {
    // 1500 work items 200 ms apart from 11:50:00: the first read, at 11:56:00, sees only those before 11:51:00 settled.
    const items = burst(1500, "2026-11-13T11:50:00.000Z", 200)
    const { read } = fake({ [SITE]: items })
    const first = await drain(read, { since: "2026-11-13T11:00:00Z", limit: 100 }, Date.parse("2026-11-13T11:56:00Z"))
    expect(first.titles).toEqual(titlesOf(items.filter((item) => jiraTime(item.fields["updated"])! <= Date.parse("2026-11-13T11:51:00Z"))))
    const second = await drain(read, { cursor: first.cursor, limit: 100 }, Date.parse("2026-11-13T12:10:00Z"))
    expect([...first.titles, ...second.titles]).toEqual(titlesOf(items))
    expect([...first.gaps, ...second.gaps]).toEqual([])
  })

  test("a burst larger than one call can read past is passed with a window-truncated gap, once, and the feed moves on", async () => {
    // 10,050 work items in one millisecond: more than SEARCH_PAGES pages, none of which can be complete before the next.
    const jam = Array.from({ length: SEARCH_PAGES * SEARCH_PAGE + 50 }, (_, index) => issue(100_000 + index, "2026-11-12T10:00:00.000+0000"))
    const after = issue(9, "2026-11-12T11:00:00.000+0000", "After the burst")
    const { read } = fake({ [SITE]: [...jam, after] })
    const cursor = encodeBoundCursor(bindingOf(ACCOUNT), { a: ACCOUNT, f: Date.parse("2026-11-12T09:59:00Z"), p: { [SITE]: [Date.parse("2026-11-12T09:59:00Z"), ""] } })
    const page = await jiraEvents(read, SIGNED, { cursor }, NOW)
    expect(page.gap).toEqual({ reason: "window-truncated", since: "2026-11-12T09:59:00.000Z" })
    expect(page).toMatchObject({ events: [], more: true })
    const next = await jiraEvents(read, SIGNED, { cursor: page.cursor }, NOW)
    expect(next.gap).toBeUndefined()
    expect(next.events.map((event) => event.title)).toEqual(["EX-9: After the burst"])
  }, 60_000)

  test("a work item updated while the pages are read moves no other past the cursor: each search page is read whole", async () => {
    const items = burst(250, "2026-11-12T08:00:00.000Z", 60_000, 70_000)
    const state = { [SITE]: [...items] }
    const { read: base } = fake(state)
    let searched = 0
    // After the first search, the first work item is updated again: a search paged by offset would shift by one.
    const read: Read = async (tool, input) => {
      const answer = await base(tool, input)
      if (tool === "searchJiraIssuesUsingJql" && ++searched === 1) {
        state[SITE]![0] = { ...items[0]!, fields: { ...items[0]!.fields, updated: "2026-11-13T11:59:00.000+0000" } }
      }
      return answer
    }
    const all = await drain(read, { since: "2026-11-12T00:00:00Z", limit: 500 })
    // Every settled work item, the moved one at the update the first search saw; its new update waits to settle.
    expect(all.titles).toEqual(titlesOf(items.filter((item) => jiraTime(item.fields["updated"])! <= NOW - SETTLE_MS)))
    expect(searched).toBeGreaterThan(1)
  })

  test("a site missing from one answer keeps its position, and lists nothing again when it comes back", async () => {
    const both = [...FIXTURE.resources]
    const { read: full } = fake(FIXTURE.issues, both)
    const first = await jiraEvents(full, SIGNED, { since: "2026-11-12T00:00:00Z" }, NOW)
    expect(first.events).toHaveLength(3)
    const { read: missing } = fake(FIXTURE.issues, [FIXTURE.resources[1]!])
    const gone = await jiraEvents(missing, SIGNED, { cursor: first.cursor }, NOW)
    expect(gone.events).toEqual([])
    const back = await jiraEvents(full, SIGNED, { cursor: gone.cursor }, NOW)
    expect(back.events).toEqual([])
  })

  test("a work item Jira sends without an id or update time is left out, not the whole read", async () => {
    const broken = { id: "77", key: "EX-77", fields: { summary: "No update time" } }
    const { read } = fake({ [SITE]: [broken as Issue, ...FIXTURE.issues[SITE]!] })
    const page = await jiraEvents(read, SIGNED, { since: "2026-11-12T00:00:00Z" }, NOW)
    expect(page.events.map((event) => event.title)).toEqual(["EX-1: Plan the queue migration", "EX-2: Review the release notes", "EX-10: Fix the flaky sign-in test"])
  })

  test("refuses a scope: the source declares none", async () => {
    const { read } = fake()
    await expect(jiraEvents(read, SIGNED, { scope: {} }, NOW)).rejects.toThrow(/^INPUT_INVALID: /)
  })

  test("refuses more sites than one cursor follows", async () => {
    const resources = Array.from({ length: MAX_SITES + 1 }, (_, index) => ({ cloudId: `00000000-0000-4000-8000-00000000000${index}`, products: [{ id: "jira" }] }))
    const { read } = fake({}, resources)
    await expect(jiraEvents(read, SIGNED, {}, NOW)).rejects.toThrow(/^UNAVAILABLE: The Atlassian sign-in reaches 9 Jira sites/)
  })

  test("a sign-in that reaches no Jira site answers an empty page", async () => {
    const { read } = fake({}, [FIXTURE.resources[1]!])
    expect(await jiraEvents(read, SIGNED, {}, NOW)).toMatchObject({ events: [], more: false })
  })

  test("an answer it cannot read is UNAVAILABLE, naming the tool", async () => {
    const shapes: Record<string, unknown> = { getAccessibleAtlassianResources: { data: { nothing: true } }, searchJiraIssuesUsingJql: { data: { issues: [{ id: "1" }] } } }
    for (const broken of Object.keys(shapes)) {
      const { read } = fake()
      const reading: Read = async (tool, input) => (tool === broken ? shapes[tool] : read(tool, input))
      await expect(jiraEvents(reading, SIGNED, { since: "2026-11-12T00:00:00Z" }, NOW)).rejects.toThrow(new RegExp(`^UNAVAILABLE: Atlassian's ${broken} answered in a shape`))
    }
  })
})

describe("probe", () => {
  test("names the signed-in account and its owner from one atlassianUserInfo read", async () => {
    const { read, calls } = fake()
    const recorded: unknown[] = []
    expect(await jiraProbe(read, {}, (signedIn) => void recorded.push(signedIn))).toEqual({ source: "jira", account: ACCOUNT, owner: { id: `atlassian:${ME}`, label: ME }, trust: "untrusted" })
    expect(recorded).toEqual([SIGNED])
    expect(await jiraProbe(read, { source: "jira", account: ACCOUNT })).toMatchObject({ account: ACCOUNT })
    expect(calls.map((entry) => entry.tool)).toEqual(["atlassianUserInfo", "atlassianUserInfo"])
  })

  test("refuses another account, another source and another input", async () => {
    const { read } = fake()
    await expect(jiraProbe(read, { account: "someone" })).rejects.toThrow(/^ACCOUNT_MISMATCH: Jira is signed in to another Atlassian account than "someone"/)
    await expect(jiraProbe(read, { source: "linear" })).rejects.toThrow(/^SOURCE_UNKNOWN: /)
    await expect(jiraProbe(read, { since: "2026-11-12" })).rejects.toThrow(/^INPUT_INVALID: /)
  })

  test("reads the account id as Atlassian's /me writes it too, with a name for the label and never the email", () => {
    expect(signedInOf({ account_id: "5b10a2844c20165700ede21g", name: "Sam Okafor", email: "sam.okafor@example.com" })).toEqual({
      account: "5b10a2844c20165700ede21g",
      owner: { id: "atlassian:5b10a2844c20165700ede21g", label: "Sam Okafor" },
    })
    expect(() => signedInOf({ data: { accountId: "has space" } })).toThrow(/^UNAVAILABLE: /)
  })
})

describe("reading Atlassian's answers", () => {
  test("Jira's times, with an offset that has no colon", () => {
    expect(jiraTime("2026-11-12T09:00:00.120+0100")).toBe(Date.parse("2026-11-12T08:00:00.120Z"))
    expect(jiraTime("2026-11-12T09:00:00.000-0530")).toBe(Date.parse("2026-11-12T14:30:00.000Z"))
    expect(jiraTime("2026-11-12T09:00:00Z")).toBe(Date.parse("2026-11-12T09:00:00Z"))
    expect(jiraTime("yesterday")).toBeUndefined()
  })

  test("the sites: Jira's, by cloud id, from either answer shape", () => {
    expect(sitesOf({ data: { resources: FIXTURE.resources } }).map((site) => site.cloudId)).toEqual([SITE])
    expect(sitesOf([{ id: SITE, url: "https://example.atlassian.net/", scopes: ["read:jira-work"] }, { id: OTHER_SITE, scopes: ["read:confluence-content.all"] }])).toEqual([{ cloudId: SITE, url: "https://example.atlassian.net" }])
  })
})

/** The plugin's options over executors that throw or answer as `behave` says. */
function options(behave: (tool: string) => unknown, state = "connected", asserted: string[] = []): EventsOptions {
  const tools = ["atlassianUserInfo", "getAccessibleAtlassianResources", "searchJiraIssuesUsingJql"].map((tool) => ({
    id: `jira_${tool}`,
    execute: async () => {
      const result = behave(tool)
      if (result instanceof Error || (typeof result === "object" && result !== null && "_tag" in result)) throw result
      return result
    },
  }))
  return {
    tool: { list: async () => (state === "connected" ? tools : []) as never },
    mcp: { list: async () => ({ data: [{ name: "jira", status: { status: state } }] }) as never },
    permission: { assert: async (input) => void asserted.push(input.action) },
    owned: () => true,
    signIn: async () => "cred_test",
    signIns: signIns(),
    now: () => NOW,
  }
}

const toolError = (message: string, cause?: unknown) => Object.assign(new Error(message), { _tag: "Tool.Error", ...(cause === undefined ? {} : { error: cause }) })

describe("reading through OpenCode's executors", () => {
  test("reads structured output, and JSON text without it", async () => {
    const structured = reader(options(() => ({ output: { data: FIXTURE.me } })), call() as never)
    expect(await structured("atlassianUserInfo", {})).toEqual({ data: FIXTURE.me })
    const textual = reader(options(() => ({ content: [{ type: "text", text: JSON.stringify(FIXTURE.me) }] })), call() as never)
    expect(await textual("atlassianUserInfo", {})).toEqual(FIXTURE.me)
    const garbled = reader(options(() => ({ content: [{ type: "text", text: "not json" }] })), call() as never)
    await expect(garbled("atlassianUserInfo", {})).rejects.toThrow(/^UNAVAILABLE: Atlassian's atlassianUserInfo answered in a shape/)
  })

  test("Atlassian's own failure is UNAVAILABLE, a rate limit RATE_LIMITED, and a permission refusal passes through", async () => {
    const failing = reader(options(() => toolError("Jira returned 500: internal error")), call() as never)
    await expect(failing("searchJiraIssuesUsingJql", {})).rejects.toThrow(/^UNAVAILABLE: Atlassian's searchJiraIssuesUsingJql failed: Jira returned 500/)
    const limited = reader(options(() => toolError("429 Too Many Requests: rate limit exceeded")), call() as never)
    await expect(limited("searchJiraIssuesUsingJql", {})).rejects.toThrow(/^RATE_LIMITED: /)
    const refusal = toolError("Permission denied: jira_searchJiraIssuesUsingJql", { request: { action: "jira_searchJiraIssuesUsingJql" } })
    const refused = reader(options(() => refusal), call() as never)
    await expect(refused("searchJiraIssuesUsingJql", {})).rejects.toBe(refusal)
  })

  test("a server that needs a sign-in is NEEDS_SIGN_IN; one that is not connected UNAVAILABLE", async () => {
    await expect(reader(options(() => ({}), "needs_auth"), call() as never)("atlassianUserInfo", {})).rejects.toThrow(/^NEEDS_SIGN_IN: /)
    await expect(reader(options(() => ({}), "failed"), call() as never)("atlassianUserInfo", {})).rejects.toThrow(/^UNAVAILABLE: The jira MCP server is failed/)
  })

  test("the tools RPC reads a refusal's code and next step, and the methods assert their own action first", async () => {
    const asserted: string[] = []
    const opts = options(() => toolError("boom"), "connected", asserted)
    const unknown = await eventsMethod(opts).run({}, call()).then(() => undefined, (error: unknown) => pluginError(error))
    expect(unknown).toMatchObject({ code: "UNAVAILABLE", next: "Call probe for the jira source, then call events_list again." })
    const failure = await probeMethod(opts).run({}, call()).then(() => undefined, (error: unknown) => pluginError(error))
    expect(failure).toMatchObject({ code: "UNAVAILABLE", what: "Atlassian's atlassianUserInfo failed: boom" })
    expect(asserted).toEqual(["jira_events_list", "jira_probe"])
    expect(pluginError(new Error("plain"))).toBeUndefined()
  })

  test("probe records who the sign-in is, and events_list then reads the fixture through the executors for that account", async () => {
    const calls: string[] = []
    const known = signIns()
    const opts = sourceOptions(FIXTURE, { permission: { assert: async () => {} } }, calls, known)
    expect(await probeMethod(opts).run({}, call())).toMatchObject({ account: ACCOUNT })
    expect(known.get("cred_conformance")).toEqual(SIGNED)
    const page = (await eventsMethod(opts).run({ since: "2026-11-12T00:00:00Z" }, call())) as { account: string; events: unknown[] }
    expect(page).toMatchObject({ account: ACCOUNT })
    expect(page.events).toHaveLength(3)
    expect(calls).toEqual(["atlassianUserInfo", "getAccessibleAtlassianResources", "searchJiraIssuesUsingJql"])
    // Another sign-in has not been probed: its listing waits for a probe.
    const other = { ...opts, signIn: async () => "cred_other" }
    await expect(eventsMethod(other).run({}, call())).rejects.toThrow(/^UNAVAILABLE: The plugin does not know yet/)
  })
})

describe("conformance", () => {
  test("the source contract's kit passes jira.activity, with every check that applies run", async () => {
    const reports = await conformanceReports()
    expect(reports.map((report) => [report.source, report.ok, report.incomplete, report.problems])).toEqual([
      ["jira.activity", true, false, []],
      ["jira.issues", true, false, []],
    ])
    const notApplicable = reports[0]!.checks.filter((check) => check.notApplicable)
    expect(notApplicable.find((check) => check.name === "gap-and-cursor-expired")?.reason).toContain("never expires")
    expect(notApplicable.find((check) => check.name === "failed-holds-cursor")?.reason).toContain("fails the whole events_list")
  })
})
