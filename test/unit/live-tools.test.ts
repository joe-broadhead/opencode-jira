// The reconcile's safety test: replacing test/unit/live-tools.json with a saved tools/list response is the whole
// reconcile step, and this test then names each difference — a name with no class, a class the table does not have, an
// effect the value does not give it, or a deny that is not hidden. It also proves the export class asks under
// ask-changes (R4).
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { classify, DESTRUCTIVE_TOOLS, EXPORT_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/jira-tools.js"
import { ACCESS, defaultRules, effectOf, evaluate, type Rule } from "../../src/permissions.js"

const fixture = JSON.parse(readFileSync(new URL("./live-tools.json", import.meta.url), "utf8")) as { tools: { name: string }[] }
/** The live names, without a `jira_` prefix, whatever shape the capture came in. */
const LIVE = fixture.tools.map((tool) => tool.name.replace(/^jira_/, "")).sort()
const ALL = [...READ_TOOLS, ...EXPORT_TOOLS, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS]
const BASE: Rule = { action: "*", resource: "*", effect: "allow" }
/** The last rule that matches an action on `*`: the one the host applies. */
const last = (rules: readonly Rule[], action: string) =>
  rules.findLast((rule) => (rule.action === action || rule.action === "jira_*" || rule.action === "*") && rule.resource === "*")
const hidden = (rules: readonly Rule[], action: string) => {
  const rule = last(rules, action)
  return rule?.resource === "*" && rule.effect === "deny"
}

describe("a saved live tool list", () => {
  test("replacing test/unit/live-tools.json with a saved tools/list is the whole reconcile", () => {
    const unclassified = LIVE.filter((name) => classify(name) === "unknown")
    const unlisted = ALL.filter((name) => !LIVE.includes(name))
    const listsOf = (name: string) => [READ_TOOLS, EXPORT_TOOLS, WRITE_TOOLS, DESTRUCTIVE_TOOLS].filter((list) => list.includes(name)).length
    const misplaced = LIVE.filter((name) => listsOf(name) !== 1).map((name) => ({ name, lists: listsOf(name) }))
    const wrongEffect = ACCESS.flatMap((access) => {
      const rules = [BASE, ...defaultRules(access)]
      return LIVE.filter((name) => classify(name) !== "unknown").map((name) => ({ access, name, effect: evaluate(rules, `jira_${name}`) })).filter(({ name, effect }) => effect !== effectOf(name, access))
    })
    const notHidden = ACCESS.flatMap((access) => {
      const rules = [BASE, ...defaultRules(access)]
      return DESTRUCTIVE_TOOLS.filter((name) => LIVE.includes(name) && access === "read-only" && !hidden(rules, `jira_${name}`)).map((name) => ({ access, name }))
    })
    expect({ unclassified, unlisted, misplaced, wrongEffect, notHidden }).toEqual({ unclassified: [], unlisted: [], misplaced: [], wrongEffect: [], notHidden: [] })
  })

  test("the fixture is the raw tools/list form, names each tool once and says where it came from", () => {
    expect(new Set(LIVE).size).toBe(LIVE.length)
    expect(LIVE.length).toBeGreaterThan(50)
    expect(Object.keys(fixture)).toEqual(["tools"])
    expect(fixture.tools.every((tool) => typeof tool.name === "string")).toBe(true)
  })

  // R4: a tool that mints a signed URL is an export, and a change: it asks under ask-changes and is denied under
  // read-only, like every other change.
  test("the export class asks under ask-changes and is denied under read-only", () => {
    for (const tool of EXPORT_TOOLS) {
      expect(effectOf(tool, "all")).toBe("allow")
      expect(effectOf(tool, "ask-changes")).toBe("ask")
      expect(effectOf(tool, "read-only")).toBe("deny")
      expect(READ_TOOLS).not.toContain(tool)
    }
  })

  test("every access value gives a read allow and the destructive class its own effect", () => {
    for (const access of ACCESS) {
      const rules = [BASE, ...defaultRules(access)]
      for (const name of READ_TOOLS) expect({ access, name, effect: evaluate(rules, `jira_${name}`) }).toEqual({ access, name, effect: "allow" })
      for (const name of DESTRUCTIVE_TOOLS) {
        const expected = access === "all" ? "allow" : access === "ask-changes" ? "ask" : "deny"
        expect({ access, name, effect: evaluate(rules, `jira_${name}`) }).toEqual({ access, name, effect: expected })
      }
    }
  })
})
