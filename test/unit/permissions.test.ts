import { describe, expect, test } from "bun:test"
import { DESTRUCTIVE_TOOLS, EXPORT_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/jira-tools.js"
import { ACCESS, defaultRules, effectOf, evaluate, hasDefaultRules, insertRules, registerDefaultRules, unguardedAgents, type Rule } from "../../src/permissions.js"
import { agentEditor, allow, builtInAgents, transforms, type AgentEditor, type FakeAgent } from "./fake.js"

const deny = (action: string): Rule => ({ action, resource: "*", effect: "deny" })
const allowAll = (action: string): Rule => ({ action, resource: "*", effect: "allow" })
const askAll: Rule = { action: "jira_*", resource: "*", effect: "ask" }
const ACTIONS = ["jira_searchJiraIssuesUsingJql", "jira_getJiraIssue", "jira_downloadJiraIssueAttachment", "jira_createJiraIssue", "jira_shiny_new_tool", "jira_deleteJiraIssue"]
const effects = (rules: readonly Rule[]) => ACTIONS.map((action) => evaluate(rules, action))

describe("defaultRules", () => {
  // R18: every tool the plugin registers is allowed at the default, the namespace pattern included, so a tool Jira
  // adds later is usable at once.
  test("allow everything by default: the namespace pattern, then every tool, reads and changes alike", () => {
    const rules = defaultRules("all")
    expect(rules[0]).toEqual(allowAll("jira_*"))
    expect(rules.slice(1)).toEqual([...READ_TOOLS, ...EXPORT_TOOLS, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS].map((tool) => allowAll(`jira_${tool}`)))
    expect(effects([allowAll("*"), ...rules])).toEqual(ACTIONS.map(() => "allow"))
  })

  test("ask-changes allows a read and asks for everything else, a tool Jira adds included", () => {
    const rules = defaultRules("ask-changes")
    expect(rules[0]).toEqual(askAll)
    expect(effects([allowAll("*"), ...rules])).toEqual(["allow", "allow", "ask", "ask", "ask", "ask"])
    for (const tool of READ_TOOLS) expect(evaluate(rules, `jira_${tool}`)).toBe("allow")
    for (const tool of [...EXPORT_TOOLS, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS]) expect(evaluate(rules, `jira_${tool}`)).toBe("ask")
  })

  test("read-only allows a read and denies everything else, so the destructive class is hidden", () => {
    const rules = defaultRules("read-only")
    expect(rules[0]).toEqual(deny("jira_*"))
    expect(effects([allowAll("*"), ...rules])).toEqual(["allow", "allow", "deny", "deny", "deny", "deny"])
    for (const tool of DESTRUCTIVE_TOOLS) expect(evaluate(rules, `jira_${tool}`)).toBe("deny")
  })

  test("the class decides, and the three values cover every class", () => {
    for (const access of ACCESS) {
      const changes = access === "all" ? "allow" : access === "ask-changes" ? "ask" : "deny"
      expect(effectOf("getJiraIssue", access)).toBe("allow")
      expect(effectOf("downloadJiraIssueAttachment", access)).toBe(changes)
      expect(effectOf("createJiraIssue", access)).toBe(changes)
      expect(effectOf("deleteJiraIssue", access)).toBe(changes)
    }
  })
})

describe("insertRules", () => {
  test.each(ACCESS)("splices the %s block right after the base allow, before the agent's own rules", (access) => {
    const rules = defaultRules(access)
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

  test("only the whole block counts: the namespace rule alone is not the block, so the block is added", () => {
    const own = [allow("*"), { ...askAll }, allow("jira_createJiraIssue")]
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
    expect(effects(plan.permissions)).toEqual(ACTIONS.map(() => "allow"))
  })

  test("the user's rules come later and win, both ways", () => {
    const permissions = [allow("*")]
    insertRules(permissions, defaultRules())
    permissions.push(deny("jira_createJiraIssue"), { action: "jira_deleteJiraIssue", resource: "*", effect: "ask" }, deny("jira_search*"))
    expect(effects(permissions)).toEqual(["deny", "allow", "allow", "deny", "allow", "ask"])
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
    expect(problems).toEqual(["RULES_NOT_ADDED: Jira's default permission rules could not be added (boom). Next step: Restart OpenCode."])
  })
})

describe("unguardedAgents", () => {
  test("names no agent under access all, where the block restates the base allow", () => {
    const agents = [{ id: "reviewer", permissions: [allow("*")] }]
    expect(unguardedAgents(agents)).toEqual([])
    expect(unguardedAgents(agents, "all")).toEqual([])
  })

  test("names agents with a base allow and no block once the access restricts", () => {
    const guarded = [allow("*"), ...defaultRules("read-only")]
    const agents = [
      { id: "build", permissions: guarded },
      { id: "reviewer", permissions: [allow("*")] },
      { id: "fixed", permissions: [allow("*"), ...defaultRules("read-only"), allow("jira_createJiraIssue")] },
      { id: "other-plugin-first", permissions: [allow("*"), allow("github_*"), ...defaultRules("read-only")] },
      { id: "block-before-base", permissions: [...defaultRules("read-only"), allow("*")] },
      // No base allow: the plugin adds no rules there, and nothing needs fixing.
      { id: "own-allow-no-base", permissions: [allow("jira_*")] },
    ]
    expect(unguardedAgents(agents, "read-only")).toEqual(["reviewer", "block-before-base"])
    expect(hasDefaultRules(guarded, "read-only")).toBe(true)
    expect(hasDefaultRules([...defaultRules("read-only")], "read-only")).toBe(false)
  })
})
