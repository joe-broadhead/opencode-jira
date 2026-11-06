// The reconcile's safety test (DR-9): every tool in a captured live list must be classified, and every tool the default
// rules deny must be hidden from the model. The fixture holds the provisional names today; replacing it with the list
// from a signed-in server is the whole reconcile step, and this test then fails on any name, class or effect that the
// lists, the rules or `jelly.tools` do not cover.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { classify, DENY_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/jira-tools.js"
import { defaultRules, evaluate, type Rule } from "../../src/permissions.js"

const fixture = JSON.parse(readFileSync(new URL("./live-tools.json", import.meta.url), "utf8")) as { source: string; tools: { name: string }[] }
/** The live names, without a `jira_` prefix, whatever shape the capture came in. */
const LIVE = fixture.tools.map((tool) => tool.name.replace(/^jira_/, "")).sort()
const BASE: Rule = { action: "*", resource: "*", effect: "allow" }
const EFFECT = { read: "allow", write: "ask", denied: "deny" } as const
/** The last rule that matches an action on `*`: the one the host applies. */
const last = (rules: readonly Rule[], action: string) =>
  rules.findLast((rule) => (rule.action === action || rule.action === "jira_*" || rule.action === "*") && rule.resource === "*")

describe("a captured live tool list", () => {
  test("names each tool once and says where it came from", () => {
    expect(new Set(LIVE).size).toBe(LIVE.length)
    expect(LIVE.length).toBeGreaterThan(50)
    expect(fixture.source).toContain("tools/list")
  })

  test("classifies every live tool: none is unknown, so no live tool runs on the catch-all ask alone", () => {
    expect(LIVE.filter((name) => classify(name) === "unknown")).toEqual([])
  })

  test("gives every live tool exactly one deciding rule, with its own class's effect", () => {
    const rules = defaultRules()
    for (const name of LIVE) {
      const action = `jira_${name}`
      const kind = classify(name) as keyof typeof EFFECT
      const deciding = last(rules, action)!
      // A read and a denied tool decide on their own rule; a write on the marker, which is what keeps it asking.
      expect({ name, decided: deciding.action }).toEqual({ name, decided: kind === "write" ? "jira_*" : action })
      expect({ name, effect: deciding.effect }).toEqual({ name, effect: EFFECT[kind] })
      expect({ name, evaluated: evaluate([BASE, ...rules], action) }).toEqual({ name, evaluated: EFFECT[kind] })
      expect({ name, own: rules.filter((rule) => rule.action === action).length }).toEqual({ name, own: kind === "write" ? 0 : 1 })
    }
  })

  test("hides every live tool the rules deny: the last matching rule is that deny", () => {
    const rules = defaultRules()
    const hidden = LIVE.filter((name) => classify(name) === "denied")
    expect(hidden.sort()).toEqual([...DENY_TOOLS].sort())
    for (const name of hidden) expect({ name, rule: last(rules, `jira_${name}`) }).toEqual({ name, rule: { action: `jira_${name}`, resource: "*", effect: "deny" } })
    // And the three lists partition the live names, so a name in two places or in none fails here.
    expect([...READ_TOOLS, ...WRITE_TOOLS, ...DENY_TOOLS].sort()).toEqual(LIVE)
  })
})
