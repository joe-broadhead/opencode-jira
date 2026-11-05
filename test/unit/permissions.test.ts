import { describe, expect, test } from "bun:test"
import { DENY_TOOLS, READ_TOOLS } from "../../src/jira-tools.js"
import { defaultRules, evaluate, hasDefaultRules, insertRules, registerDefaultRules, unguardedAgents, type Rule } from "../../src/permissions.js"
import { agentEditor, allow, builtInAgents, transforms, type AgentEditor, type FakeAgent } from "./fake.js"

const ask: Rule = { action: "jira_*", resource: "*", effect: "ask" }
const deny = (action: string): Rule => ({ action, resource: "*", effect: "deny" })
const ACTIONS = ["jira_searchJiraIssuesUsingJql", "jira_getJiraIssue", "jira_createJiraIssue", "jira_deleteJiraIssue", "jira_shiny_new_tool", "jira_editJiraEntityProperty"]
const effects = (rules: readonly Rule[]) => ACTIONS.map((action) => evaluate(rules, action))

describe("defaultRules", () => {
  test("ask for every Jira tool, then allow each known read, then deny the denied tools last", () => {
    const rules = defaultRules()
    expect(rules[0]).toEqual(ask)
    expect(rules.slice(1, 1 + READ_TOOLS.length)).toEqual(READ_TOOLS.map((tool) => ({ action: `jira_${tool}`, resource: "*", effect: "allow" })))
    expect(rules.slice(1 + READ_TOOLS.length)).toEqual(DENY_TOOLS.map((tool) => deny(`jira_${tool}`)))
  })

  test("reads allow; edits of an entity property and deletes are denied; everything else asks", () => {
    expect(effects([allow("*"), ...defaultRules()])).toEqual(["allow", "allow", "ask", "deny", "ask", "deny"])
    expect(evaluate([allow("*"), ...defaultRules()], "jira_manageJiraSprint")).toBe("ask")
  })

  test("the documented opt-in turns a denied tool back into an ask, never an allow", () => {
    const optIn = { action: "jira_editJiraEntityProperty", resource: "*", effect: "ask" as const }
    expect(evaluate([allow("*"), ...defaultRules(), optIn], "jira_editJiraEntityProperty")).toBe("ask")
  })
})

describe("insertRules", () => {
  test("splices the rules right after the base allow, before the agent's own rules", () => {
    const rules = defaultRules()
    for (const agent of builtInAgents()) {
      const before = agent.permissions.slice()
      expect(insertRules(agent.permissions, rules)).toBe(true)
      expect(agent.permissions).toEqual([before[0]!, ...rules, ...before.slice(1)])
    }
  })

  test("is idempotent, and finds the block after another plugin's", () => {
    const permissions = [allow("*")]
    insertRules(permissions, defaultRules())
    const once = permissions.slice()
    expect(insertRules(permissions, defaultRules())).toBe(false)
    expect(permissions).toEqual(once)
    const later = [allow("*"), allow("github_*"), ...defaultRules(), allow("jira_createJiraIssue")]
    expect(insertRules(later, defaultRules())).toBe(false)
  })

  test("only the whole block counts: the ask rule alone is not the block, so the block is added", () => {
    const own = [allow("*"), { ...ask }, allow("jira_createJiraIssue")]
    expect(hasDefaultRules(own)).toBe(false)
    expect(insertRules(own, defaultRules())).toBe(true)
    expect(own.slice(1, 1 + defaultRules().length)).toEqual(defaultRules())
  })

  test("leaves agents without a base allow untouched and never throws on odd lists", () => {
    for (const permissions of [[], [deny("*")], [allow("read")]] as Rule[][]) {
      const before = permissions.slice()
      expect(insertRules(permissions, defaultRules())).toBe(false)
      expect(permissions).toEqual(before)
    }
  })

  test("stricter agents stay stricter: Explore's own deny still wins", () => {
    const [, plan, explore] = builtInAgents() as [FakeAgent, FakeAgent, FakeAgent]
    insertRules(explore.permissions, defaultRules())
    expect(effects(explore.permissions)).toEqual(["deny", "deny", "deny", "deny", "deny", "deny"])
    insertRules(plan.permissions, defaultRules())
    expect(effects(plan.permissions)).toEqual(["allow", "allow", "ask", "deny", "ask", "deny"])
  })

  test("the user's rules come later and win, both ways", () => {
    const permissions = [allow("*")]
    insertRules(permissions, defaultRules())
    permissions.push(allow("jira_createJiraIssue"), { action: "jira_deleteJiraIssue", resource: "*", effect: "ask" }, deny("jira_search*"))
    expect(effects(permissions)).toEqual(["deny", "allow", "allow", "ask", "ask", "deny"])
  })
})

describe("registerDefaultRules", () => {
  test("adds the rules to every agent once per rebuild and reports no problem", async () => {
    const { transform, run } = transforms<AgentEditor>()
    const problems: (string | undefined)[] = []
    await registerDefaultRules({ transform }, defaultRules(), (problem) => problems.push(problem))
    for (let rebuild = 0; rebuild < 2; rebuild++) {
      const agents = builtInAgents()
      run(agentEditor(agents))
      for (const agent of agents) expect(agent.permissions.filter((rule) => rule.action === "jira_*")).toHaveLength(1)
    }
    expect(problems).toEqual([undefined, undefined])
  })

  test("never throws; a failure is reported for status", async () => {
    const { transform, run } = transforms<AgentEditor>()
    const problems: (string | undefined)[] = []
    await registerDefaultRules({ transform }, defaultRules(), (problem) => problems.push(problem))
    const broken = { ...agentEditor([]), list: () => { throw new Error("boom") } }
    expect(() => run(broken)).not.toThrow()
    expect(problems).toEqual([
      "RULES_NOT_ADDED: Jira's default permission rules could not be added (boom), so Jira tools may run without asking. Next step: Restart OpenCode.",
    ])
  })
})

describe("unguardedAgents", () => {
  test("names agents with a base allow, no block, and rules that would let a new Jira tool run", () => {
    const guarded = [allow("*"), ...defaultRules()]
    const agents = [
      { id: "build", permissions: guarded },
      { id: "reviewer", permissions: [allow("*")] },
      { id: "fixed", permissions: [allow("*"), ...defaultRules(), allow("jira_createJiraIssue")] },
      { id: "other-plugin-first", permissions: [allow("*"), allow("github_*"), ...defaultRules()] },
      { id: "block-before-base", permissions: [...defaultRules(), allow("*")] },
      { id: "ask-rule-only", permissions: [allow("*"), { ...ask }] },
      { id: "locked", permissions: [allow("*"), deny("*")] },
      { id: "denies-jira", permissions: [allow("*"), deny("jira_*")] },
      // No base allow: the plugin adds no rules there, and nothing needs fixing.
      { id: "own-allow-no-base", permissions: [allow("jira_*")] },
    ]
    expect(unguardedAgents(agents)).toEqual(["reviewer", "block-before-base"])
    expect(hasDefaultRules(guarded)).toBe(true)
    expect(hasDefaultRules([...defaultRules()])).toBe(false)
  })
})
