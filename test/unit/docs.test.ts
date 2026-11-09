// The docs and skills must match the code: tool names, the access blocks, error codes, the uninstall order and the
// Jelly guide. Every tool count they state is checked against src/jira-tools.ts, so a change there cannot leave a stale
// number behind.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { CODES, TESTED_HOSTS, UNTESTED_EXAMPLE } from "../../src/constants.js"
import { DESTRUCTIVE_TOOLS, EXPORT_TOOLS, PARAMETERS, READ_TOOLS, WRITE_TOOLS } from "../../src/jira-tools.js"
import { METHODS, NEXT_STEPS, TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { ACCESS, defaultRules } from "../../src/permissions.js"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
// Everything a user or the model reads about the current release.
const FILES = [
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "AGENTS.md",
  ...readdirSync(join(ROOT, "docs")).map((name) => `docs/${name}`),
  ...readdirSync(join(ROOT, "skills")).map((name) => `skills/${name}/SKILL.md`),
]
const KNOWN = [...READ_TOOLS, ...EXPORT_TOOLS, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS]
const raw = (file: string) => readFileSync(join(ROOT, file), "utf8")
const text = (file: string) => raw(file).replace(/\s+/g, " ")
/** The per-tool deny the README and the guide give as way 3, for the tool a reader is likeliest to want off. */
const OPT_IN_TOOL = '{ "action": "jira_deleteJiraIssue", "resource": "*", "effect": "deny" }'

describe("docs", () => {
  test.each(FILES)("%s states no count of read, write or declared tools that could go stale", (file) => {
    const counts = [...text(file).matchAll(/\b\d+ (?:known )?(?:read|write)(?:s\b| tools\b| read-only)|\b\d+ tools are declared/g)].map((match) => match[0])
    const stale = counts.filter((count) => !count.startsWith(`${READ_TOOLS.length} read`) && !count.startsWith(`${WRITE_TOOLS.length} write`) && count !== `${KNOWN.length} tools are declared`)
    expect(stale).toEqual([])
  })

  test.each(FILES)("%s names only Jira tools the plugin knows", (file) => {
    const named = [...text(file).matchAll(/\bjira_([a-zA-Z][A-Za-z0-9]*)(?![\w*])/g)].map((match) => match[1]!)
    expect(named.filter((tool) => !KNOWN.includes(tool))).toEqual([])
  })

  test.each(["README.md", "docs/configuration.md", "docs/scripting.md", "docs/jelly.md", "SECURITY.md"])("%s says nothing provisional or pending", (file) => {
    expect(text(file)).not.toMatch(/provisional|not yet (?:checked|published|signed)|private package|TODO/i)
  })

  test("the README names no version of the plugin, not even in an example", () => {
    expect(text("README.md")).not.toMatch(/opencode-jira@\d|\b0\.\d+\.\d+\b|\bv\d+\.\d+\.\d+\b/)
  })

  // R18: nothing is restricted by default, so the README shows how to restrict instead. Every change is `ask` in the
  // ask-changes block and `deny` in the read-only one, and the guide repeats the per-tool rule.
  test("the README's restricting blocks cover every change and export, and the guide gives the per-tool rule", () => {
    const blocks = [...raw("README.md").matchAll(/```json\n(\[[\s\S]*?\])\n```/g)].map((match) => JSON.parse(match[1]!) as { action: string; effect: string }[])
    const effectIn = (rules: { action: string; effect: string }[], tool: string) => rules.find((rule) => rule.action === `jira_${tool}`)?.effect
    for (const tool of [...EXPORT_TOOLS, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS]) {
      expect({ tool, ask: effectIn(defaultRules("ask-changes"), tool) }).toEqual({ tool, ask: "ask" })
      expect({ tool, deny: effectIn(defaultRules("read-only"), tool) }).toEqual({ tool, deny: "deny" })
      const printed = (rules: { action: string; effect: string }[]) => blocks.some((block) => JSON.stringify(block) === JSON.stringify(rules))
      expect({ tool, askPrinted: printed(defaultRules("ask-changes")), denyPrinted: printed(defaultRules("read-only")) }).toEqual({ tool, askPrinted: true, denyPrinted: true })
    }
    // The top-level per-tool recipe the guide and the README give is a deny, never an allow.
    expect(text("README.md")).toContain(OPT_IN_TOOL)
    expect(text("docs/configuration.md")).toContain(OPT_IN_TOOL)
  })

  test.each(FILES)("%s puts no ask or allow recipe for a Jira tool at the top level, where it would reach Explore", (file) => {
    const source = raw(file)
    // Every JSON example that is a config: its top-level permissions only tighten.
    for (const [, body] of source.matchAll(/```json\n([^]*?)```/g)) {
      let config: unknown
      try {
        config = JSON.parse(body!)
      } catch {
        continue
      }
      const top = !Array.isArray(config) && typeof config === "object" && config !== null ? ((config as { permissions?: { action: string; effect: string }[] }).permissions ?? []) : []
      expect(top.filter((rule) => rule.action.startsWith("jira_") && rule.effect !== "deny")).toEqual([])
    }
    // Every ask or allow rule for one tool sits in an agent's own rules, said in its paragraph or code block. The
    // plugin's own block, which the plugin inserts itself, is the one exception.
    const blocks = source.split(/\n\s*\n/)
    blocks.forEach((block, index) => {
      if (!/\{ "action": "jira_[A-Za-z]+", "resource": "\*", "effect": "(?:ask|allow)" \}/.test(block)) return
      const context = `${blocks[index - 1] ?? ""}\n${block}`
      if (/The plugin adds these\s+rules/.test(context)) return
      // "in your permissions or an agent's own" offers the top level too: it fails.
      const agentLevel = /agent's own|"agents"/.test(context) && !/\b(?:in|to) (?:your|the same) `permissions`|here or in an agent's own/.test(context.replace(/\s+/g, " "))
      expect({ file, block: block.slice(0, 120), agentLevel }).toEqual({ file, block: block.slice(0, 120), agentLevel: true })
    })
  })

  // R18: the `all` block allows everything, and no other example in the docs or the skills hands a change an allow: a
  // reader who restricts must not be told to reopen one.
  test("no doc or skill gives a change an allow rule outside the generated block", () => {
    for (const file of FILES) {
      const source = raw(file)
      for (const tool of [...EXPORT_TOOLS, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS]) {
        const rules = [...source.matchAll(/\{[^{}]*\}/g)].map((match) => match[0])
        const allowed = rules.filter((rule) => rule.includes(`"action": "jira_${tool}"`) && /"effect"\s*:\s*"allow"/.test(rule))
        // The one exception is the README's generated `all` block, whose line is a literal allow for every tool.
        const generated = file === "README.md" && source.includes(`{ "action": "jira_${tool}", "resource": "*", "effect": "allow" }`)
        expect({ file, tool, allowed: allowed.length, generated }).toEqual({ file, tool, allowed: generated ? 1 : 0, generated })
      }
    }
  })

  // R18: the read-only block is the strict agent's shortcut; the guide's own strict recipe repeats the deny after its
  // namespace ask, so no change reopens.
  test("the guide's strict recipe repeats every deny after its jira_* ask, so none reopens", () => {
    const recipe = raw("docs/configuration.md").split("A read-only agent that asks for one change")[1]?.split("```json")[1]?.split("```")[0] ?? ""
    const ask = recipe.indexOf('"action": "jira_*", "resource": "*", "effect": "ask"')
    expect(ask).toBeGreaterThanOrEqual(0)
    for (const name of [...EXPORT_TOOLS, ...DESTRUCTIVE_TOOLS]) expect(recipe).not.toContain(`"action": "jira_${name}", "resource": "*", "effect": "allow"`)
  })

  test("the README's first lines say every tool is allowed by default, and the Jelly summary says the plugin changes things", () => {
    expect(text("README.md")).toContain("Every tool is allowed by default.")
    const { jelly } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { jelly: { summary: string } }
    expect(jelly.summary).toMatch(/make changes/)
    expect(jelly.summary.length).toBeLessThanOrEqual(120)
  })

  test("the docs need no API token, and document the token entry without a credential", () => {
    expect(text("README.md")).toContain("No API token is needed or used.")
    expect(text("docs/configuration.md")).toContain("An API-token entry, for a headless machine")
    expect(text("docs/configuration.md")).toContain('"oauth": false')
    for (const file of FILES) {
      // No credential value of any kind, and no plaintext Basic value.
      expect(text(file)).not.toMatch(/Bearer [A-Za-z0-9_-]{8,}|"Authorization": "Basic [A-Za-z0-9+/=]{8,}/)
    }
  })

  test("keeps the CLI sign-in and sign-out commands, with the folder and cold-start caveat, and /connect first", () => {
    const caveat = "Run it from the project folder where the plugin is installed, or remove the account in `/connect` → **Jira**. If it answers `MCP server not found: jira`, OpenCode is still opening that folder: wait a few seconds and run it again."
    expect(text("README.md")).toContain(caveat)
    // `mcp auth` carries the same folder and retry advice.
    expect(text("README.md")).toContain("Run it from the project folder where the plugin is installed; if it answers `MCP server not found: jira`, OpenCode is still opening that folder: wait a few seconds and run it again")
    expect(text("skills/jira/SKILL.md")).toContain("run from the project folder, and if it answers `MCP server not found: jira`, wait a few seconds and run it again")
    // The status next step and the tools RPC's AUTH_REQUIRED name `mcp auth`, so each carries the retry.
    for (const file of ["src/status.ts", "src/host/tools-rpc.ts"]) {
      expect(text(file)).toContain("run it from the project folder, and if it answers MCP server not found:")
    }
    // The Uninstall offers /connect first, and the CLI from the project folder second.
    const uninstall = /## Uninstall(.*?)## Links/.exec(text("README.md"))?.[1] ?? ""
    expect(uninstall.indexOf("/connect")).toBeGreaterThanOrEqual(0)
    expect(uninstall.indexOf("/connect")).toBeLessThan(uninstall.indexOf("opencode mcp logout jira"))
    expect(text("README.md")).toContain("Signed in to the wrong Atlassian account | Remove the account in `/connect` → Jira")
  })

  // Once the plugin is removed and OpenCode reloads, `mcp logout jira` finds no server: sign out first.
  test("the README's Uninstall signs out before it removes the plugin", () => {
    const uninstall = /## Uninstall(.*?)## Links/.exec(text("README.md"))?.[1] ?? ""
    const logout = uninstall.indexOf("opencode mcp logout jira")
    const list = uninstall.indexOf("opencode auth list")
    const remove = uninstall.indexOf("opencode plugin remove @joe-broadhead/opencode-jira")
    expect(logout).toBeGreaterThanOrEqual(0)
    expect(list).toBeGreaterThan(logout)
    expect(remove).toBeGreaterThan(list)
  })

  // R6: one typed code table (CODES in src/constants.ts). `jiraError`, `errorText` and `codeText` take a PluginCode, so
  // a code outside it does not compile; this finds any code that escaped the helpers, and keeps the README's table
  // equal to the table in both directions.
  test("every code raised in src/ is in CODES, and every non-rpc code in CODES is raised", () => {
    const sources = readdirSync(join(ROOT, "src")).filter((name) => name.endsWith(".ts")).map((name) => [name, readFileSync(join(ROOT, "src", name), "utf8")] as const)
    const found = new Set(sources.flatMap(([, source]) => [...source.matchAll(/(?:jiraError|errorText|codeText)\(\s*"([A-Z][A-Z_]+)"/g)].map((match) => match[1]!)))
    // A code written into a message template, such as `STATUS_UNAVAILABLE: ...`, is caught here too.
    for (const [, source] of sources) for (const match of source.matchAll(/`([A-Z][A-Z0-9]*_[A-Z0-9_]+): /g)) found.add(match[1]!)
    expect([...found].filter((code) => !(code in CODES))).toEqual([])
    const declared = Object.entries(CODES).filter(([, entry]) => entry.surface !== "rpc").map(([code]) => code)
    expect(declared.filter((code) => !found.has(code))).toEqual([])
  })

  test("the tools RPC's next steps are exactly the rpc codes in CODES", () => {
    const rpc = Object.entries(CODES).filter(([, entry]) => entry.surface === "rpc").map(([code]) => code)
    expect(Object.keys(NEXT_STEPS).sort()).toEqual(rpc.sort())
  })

  test("the README's Errors table is CODES, in both directions, with the same surface and when", () => {
    const errors = /## Errors\n([\s\S]*?)\n## /.exec(raw("README.md"))?.[1] ?? ""
    const rows = [...errors.matchAll(/\| `([A-Z][A-Z_]+)` \| ([a-z-]+) \| ([^|]+?) \|/g)].map(([, code, surface, when]) => [code!, { surface: surface!, when: when!.trim() }] as const)
    expect(Object.fromEntries(rows)).toEqual(CODES)
  })

  test("the configuration guide documents the setup and status codes, and the scripting guide the rpc ones", () => {
    const errors = /## Errors([\s\S]*?)## /.exec(text("docs/configuration.md"))?.[1] ?? ""
    const setup = Object.entries(CODES).filter(([, entry]) => entry.surface !== "rpc").map(([code]) => code)
    expect([...errors.matchAll(/\| `([A-Z][A-Z_]+)` \|/g)].map((match) => match[1]!).sort()).toEqual(setup.sort())
    const scripting = /## Errors([\s\S]*?)## What scripts cannot do/.exec(text("docs/scripting.md"))?.[1] ?? ""
    for (const [code, entry] of Object.entries(CODES)) expect({ code, named: entry.surface !== "rpc" || scripting.includes(`\`${code}\``) }).toEqual({ code, named: true })
    const named = [...scripting.matchAll(/`([A-Z][A-Z_]+)`/g)].map((match) => match[1]!)
    expect(named.filter((code) => !(code in CODES))).toEqual([])
  })

  // R7 with R18: the README prints the whole block for every `access` value, generated from defaultRules(access), so a
  // class or an option change cannot leave the README showing a block that is not what runs.
  test("the README prints the whole default-rules block for each access value, and each equals defaultRules(access)", () => {
    const blocks = [...raw("README.md").matchAll(/```json\n(\[[\s\S]*?\])\n```/g)].map((match) => JSON.parse(match[1]!) as { action: string; effect: string }[])
    const arrays = blocks.filter((value) => Array.isArray(value) && value.some((rule) => rule?.action === "jira_*"))
    // The three generated blocks, one per value, plus the agent examples that repeat a subset.
    for (const access of ACCESS) {
      const expected = defaultRules(access)
      const found = arrays.filter((value) => JSON.stringify(value) === JSON.stringify(expected))
      expect({ access, found: found.length }).toEqual({ access, found: 1 })
    }
    // No elided block anywhere: every element is a rule, never a placeholder string.
    for (const value of blocks) if (Array.isArray(value)) for (const rule of value) expect(typeof rule).toBe("object")
    // The Permissions section opens with the family sentence.
    expect(/## Permissions\n\n\*\*Every tool is allowed by default\.\*\*/.test(raw("README.md"))).toBe(true)
  })

  // R8: every "tested on ..." mention is TESTED_HOSTS, and the untested example is a version that is not a release.
  test("every tested-on mention equals TESTED_HOSTS, and the untested example is not a tested release", () => {
    let mentions = 0
    const check = (file: string, source: string) => {
      for (const match of source.matchAll(/tested on /g)) {
        mentions += 1
        // The run of versions right after "tested on", across a line wrap, and nothing else.
        const run = /^\s*((?:\d+\.\d+\.\d+)(?:(?:,[ \t]*|\s+and\s+)(?:\d+\.\d+\.\d+))*)/.exec(source.slice(match.index! + match[0].length))?.[1] ?? ""
        expect({ file, versions: [...(run.match(/\d+\.\d+\.\d+/g) ?? [])] }).toEqual({ file, versions: [...TESTED_HOSTS] })
      }
    }
    for (const file of ["README.md", "AGENTS.md", "SECURITY.md", "docs/configuration.md"]) check(file, raw(file))
    const changelog = /## \[[\s\S]*?\] - Unreleased\n([\s\S]*?)(?:\n## \[|$)/.exec(raw("CHANGELOG.md"))?.[1] ?? ""
    expect(changelog.length).toBeGreaterThan(0)
    check("CHANGELOG.md (Unreleased)", changelog)
    expect(mentions).toBeGreaterThanOrEqual(2)
    // The places that list the releases without the words "tested on" name the same four.
    const list = `${TESTED_HOSTS.slice(0, -1).join(", ")} and ${TESTED_HOSTS.at(-1)}`
    for (const file of ["AGENTS.md", "docs/configuration.md", "CONTRIBUTING.md"]) expect({ file, list: text(file).includes(list) }).toEqual({ file, list: true })
    // The example of a release the checks do not run on is 2.2.99, never one of the tested ones.
    expect(text("docs/configuration.md")).toContain(UNTESTED_EXAMPLE)
    for (const version of TESTED_HOSTS) expect(text("docs/configuration.md")).not.toContain(`inside the range, such as ${version}`)
  })

  // R9: shipped text states behaviour, never who decided it, and names no lane.
  test("the shipped docs use no internal wording", () => {
    const banned = /\bowner(?:'s)? (?:decision|ruling|sign-off|call)\b|\bthe lead(?:'s)? (?:decision|ruling|audit|report|review)\b|\bhey-jelly\s*#|\b(?:audit|review|reconcile) lane\s+[A-Z]\d\b|\blane\s+G\d\b/i
    for (const file of FILES) expect({ file, hit: banned.exec(text(file))?.[0] }).toEqual({ file, hit: undefined })
  })

  // R1: every example runs the RPC this plugin registers, with the location header and the envelope, and names a method
  // in the table. A `<method>` placeholder names no method, but it must still carry the header and the body shape.
  test("every scripting example has the RPC id, the location header, the envelope, and a method in the table", () => {
    const names = new Set(["describe", ...METHODS.map((method) => method.name)])
    let examples = 0
    for (const file of ["docs/scripting.md", "README.md"]) {
      // A shell continuation joins its line, so one example is one logical line.
      const source = raw(file).replace(/\\\n\s*/g, " ")
      for (const match of source.matchAll(/opencode api post (\/api\/rpc\/[^\s/]+\/([A-Za-z0-9._<>-]+))[ \t]+([^\n]*)/g)) {
        examples += 1
        const [, path, method] = match
        const placeholder = method!.startsWith("<")
        expect({ file, path }).toEqual({ file, path: `/api/rpc/${TOOLS_RPC_ID}/${method}` })
        if (!placeholder) expect({ file, method, known: names.has(method!) }).toEqual({ file, method, known: true })
        const line = match[0]
        expect({ file, header: line.includes(`-H "x-opencode-directory:$PWD"`) }).toEqual({ file, header: true })
        if (placeholder) continue
        // The body may run over several lines: join the continuation lines before parsing it.
        const window = source.slice(match.index!, match.index! + match[0].length + 400).replace(/\n\s+(?=["}])/g, "")
        const body = /-d '(\{[^']*\})'/.exec(window)
        expect({ file, body: body !== null }).toEqual({ file, body: true })
        const parsed = JSON.parse(body![1]!) as { input?: { sessionID?: unknown; input?: unknown } }
        expect({ file, envelope: typeof parsed.input }).toEqual({ file, envelope: "object" })
        // `describe` takes nothing, or one session: its envelope holds no nested input. Every other method names the
        // session the script runs as, and passes the tool's own input.
        const session = typeof parsed.input!.sessionID
        if (method === "describe") {
          expect({ file, session: session === "string" || session === "undefined" }).toEqual({ file, session: true })
          expect({ file, keys: Object.keys(parsed.input!).filter((key) => key !== "sessionID") }).toEqual({ file, keys: [] })
          continue
        }
        expect({ file, session }).toEqual({ file, session: "string" })
        expect({ file, input: typeof parsed.input!.input }).toEqual({ file, input: "object" })
        // An MCP method's real input is the server's, so only the parameters the plugin records are checked.
        const recorded = PARAMETERS[method!]
        if (recorded) {
          const keys = Object.keys(parsed.input!.input as Record<string, unknown>)
          const known = recorded.map((entry) => entry.split(":")[0]!.replace(/\*$/, ""))
          expect({ file, method, unknown: keys.filter((key) => !known.includes(key)) }).toEqual({ file, method, unknown: [] })
          expect({ file, method, missing: known.filter((name) => recorded.some((entry) => entry.startsWith(`${name}*:`)) && !keys.includes(name)) }).toEqual({ file, method, missing: [] })
        }
      }
    }
    expect(examples).toBeGreaterThanOrEqual(3)
  })

  test("the Jelly guide describes the declaration as Jelly reads it, with no placeholder or version", () => {
    const guide = text("docs/jelly.md")
    expect(guide).not.toMatch(/`latest` is|None yet/)
    expect(guide).toContain("the one line in `jelly.summary`, and beside it the mark in `jelly.icon`")
    // Jelly's contracts drop an unknown top-level key; they do not refuse the declaration for it.
    expect(guide).toContain("drop a top-level key they don't know")
    expect(guide).not.toMatch(/refuses this declaration|accepts no unknown keys/)
    // R18: every declared tool is allowed, and a tool Atlassian adds later is undeclared, so Jelly runs it with the
    // plugin's own default: the guide says so plainly, a write included.
    expect(guide).toContain(`${KNOWN.length} tools are declared (${READ_TOOLS.length} read-only), every tool in \`src/jira-tools.ts\``)
    expect(guide).toContain("A tool Atlassian adds later, a write included, is not declared, so in Jelly it runs with the plugin's own default: allowed")
    const skills = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).jelly.skills as string[]
    expect(guide).toContain(`Declared: ${skills.map((name) => `\`${name}\``).join(", ")}.`)
  })

  test("the scripting guide points at the known reads, and gives Atlassian's rate limits, the cloudId and one call at a time", () => {
    const guide = text("docs/scripting.md")
    expect(guide).toContain("(`READ_TOOLS` in `src/jira-tools.ts`)")
    expect(guide).toContain("`Retry-After`")
    expect(guide).toContain("`X-RateLimit-Remaining`")
    expect(guide).toContain("Every call needs a `cloudId`")
    expect(guide).toContain("one at a time")
    expect(guide).toContain("Rovo credits")
  })

  test("the README's limits say the tool table comes from Atlassian's docs, and what Jelly cannot ask about", () => {
    const readme = text("README.md")
    expect(readme).toContain("The tool table comes from Atlassian's docs")
    expect(readme).toContain("In Jelly, a tool Atlassian adds is not asked about")
    expect(readme).not.toContain("has not been reconciled with a live tool list")
  })
})
