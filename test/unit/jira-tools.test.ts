// The tool lists in src/jira-tools.ts are the one record of Jira's tools; everything else derives from them.
import { describe, expect, test } from "bun:test"
import { classify, DENY_TOOLS, NOT_GRANTED_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/jira-tools.js"

const ALL = [...READ_TOOLS, ...WRITE_TOOLS, ...DENY_TOOLS]
/** What a read may start with: Atlassian's verbs for reading one item, listing, resolving a person, searching, a download. */
const READ_VERB = /^(?:get|list|lookup|search|download|atlassian)/

describe("Jira's tool lists", () => {
  test("name each tool once, in one list only, without the server prefix, sorted", () => {
    expect(new Set(ALL).size).toBe(ALL.length)
    for (const name of ALL) expect(name).toMatch(/^[a-z][A-Za-z0-9]{0,63}$/)
    expect(ALL.filter((name) => name.startsWith("jira_"))).toEqual([])
    for (const list of [READ_TOOLS, WRITE_TOOLS, DENY_TOOLS, NOT_GRANTED_TOOLS]) expect([...list]).toEqual([...list].sort())
  })

  test("pin the counts Atlassian's Jira groups give: 31 Jira reads, 14 writes, 7 denied", () => {
    // Two of the reads are Atlassian's common tools, which every Jira call needs.
    expect([READ_TOOLS.length, WRITE_TOOLS.length, DENY_TOOLS.length]).toEqual([33, 14, 7])
    expect(READ_TOOLS).toContain("atlassianUserInfo")
    expect(READ_TOOLS).toContain("getAccessibleAtlassianResources")
  })

  test("classify each tool by its list, and everything else as unknown", () => {
    for (const tool of READ_TOOLS) expect(classify(tool)).toBe("read")
    for (const tool of WRITE_TOOLS) expect(classify(tool)).toBe("write")
    for (const tool of DENY_TOOLS) expect(classify(tool)).toBe("denied")
    for (const tool of ["shiny_new_tool", "", "jira_getJiraIssue", "GETJIRAISSUE", "discover", "executeWrite"]) expect({ tool, class: classify(tool) }).toEqual({ tool, class: "unknown" })
  })

  test("reads never change anything: every read starts with a read verb, and no write or denied tool does", () => {
    expect(READ_TOOLS.filter((tool) => !READ_VERB.test(tool))).toEqual([])
    expect([...WRITE_TOOLS, ...DENY_TOOLS].filter((tool) => READ_VERB.test(tool) && !NOT_GRANTED_TOOLS.includes(tool))).toEqual([])
  })

  test("the permanent deletes and the project and screen settings are denied; ordinary team work asks", () => {
    expect([...DENY_TOOLS].sort()).toEqual(["createJiraProject", "deleteJiraComment", "deleteJiraIssue", "deleteJiraIssueAttachment", "editJiraEntityProperty", "updateJiraProject", "updateJiraScreen"])
    for (const tool of ["createJiraIssue", "transitionJiraIssue", "addOrEditJiraIssueComment", "manageJiraSprint", "manageJiraProjectVersion"]) expect(WRITE_TOOLS).toContain(tool)
  })

  test("the three reads the pinned scope does not grant are reads, and are not tools RPC methods", () => {
    expect([...NOT_GRANTED_TOOLS]).toEqual(["getJiraScreen", "getJiraWorkflowEditorLink", "getJiraWorkflows"])
    for (const tool of NOT_GRANTED_TOOLS) expect(classify(tool)).toBe("read")
    // They sit in Atlassian's manage_jira group, which the sign-in does not request, so they never arrive.
    expect(NOT_GRANTED_TOOLS.filter((tool) => !READ_TOOLS.includes(tool))).toEqual([])
  })
})
