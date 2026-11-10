// The tool lists in src/jira-tools.ts are the one record of Jira's tools; everything else derives from them.
import { describe, expect, test } from "bun:test"
import { classify, DESTRUCTIVE_TOOLS, EXPORT_TOOLS, NOT_GRANTED_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/jira-tools.js"

const ALL = [...READ_TOOLS, ...EXPORT_TOOLS, ...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS]
/** What a read may start with: Atlassian's verbs for reading one item, listing, resolving a person or searching. */
const READ_VERB = /^(?:get|list|lookup|search|atlassian)/

describe("Jira's tool lists", () => {
  test("name each tool once, in one list only, without the server prefix, sorted", () => {
    expect(new Set(ALL).size).toBe(ALL.length)
    for (const name of ALL) expect(name).toMatch(/^[a-z][A-Za-z0-9]{0,63}$/)
    expect(ALL.filter((name) => name.startsWith("jira_"))).toEqual([])
    for (const list of [READ_TOOLS, EXPORT_TOOLS, WRITE_TOOLS, DESTRUCTIVE_TOOLS, NOT_GRANTED_TOOLS]) expect([...list]).toEqual([...list].sort())
  })

  test("pin the counts Atlassian's Jira groups give: 33 reads, 1 export, 14 writes, 7 destructive", () => {
    // Two of the reads are Atlassian's common tools, which every Jira call needs.
    expect([READ_TOOLS.length, EXPORT_TOOLS.length, WRITE_TOOLS.length, DESTRUCTIVE_TOOLS.length]).toEqual([33, 1, 14, 7])
    expect(READ_TOOLS).toContain("atlassianUserInfo")
    // The content-format guide returns authoring guidance and writes nothing, so it is a read, as the live list shows it.
    expect(READ_TOOLS).toContain("getContentFormatGuide")
    expect(READ_TOOLS).toContain("getAccessibleAtlassianResources")
    expect(EXPORT_TOOLS).toEqual(["downloadJiraIssueAttachment"])
  })

  test("classify each tool by its list, and everything else as unknown", () => {
    for (const tool of READ_TOOLS) expect(classify(tool)).toBe("read")
    for (const tool of EXPORT_TOOLS) expect(classify(tool)).toBe("export")
    for (const tool of WRITE_TOOLS) expect(classify(tool)).toBe("write")
    for (const tool of DESTRUCTIVE_TOOLS) expect(classify(tool)).toBe("destructive")
    for (const tool of ["shiny_new_tool", "", "jira_getJiraIssue", "GETJIRAISSUE", "discover", "executeWrite"]) expect({ tool, class: classify(tool) }).toEqual({ tool, class: "unknown" })
  })

  test("reads never change anything: every read starts with a read verb, and no write or destructive tool does", () => {
    expect(READ_TOOLS.filter((tool) => !READ_VERB.test(tool))).toEqual([])
    expect([...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS].filter((tool) => READ_VERB.test(tool) && !NOT_GRANTED_TOOLS.includes(tool))).toEqual([])
  })

  test("the permanent deletes and the project and screen settings are destructive; ordinary team work is a write", () => {
    expect([...DESTRUCTIVE_TOOLS].sort()).toEqual(["createJiraProject", "deleteJiraComment", "deleteJiraIssue", "deleteJiraIssueAttachment", "editJiraEntityProperty", "updateJiraProject", "updateJiraScreen"])
    for (const tool of ["createJiraIssue", "transitionJiraIssue", "addOrEditJiraIssueComment", "manageJiraSprint", "manageJiraProjectVersion"]) expect(WRITE_TOOLS).toContain(tool)
  })

  test("the attachment download mints a secret, so it is the export class and not a read", () => {
    expect(EXPORT_TOOLS).toEqual(["downloadJiraIssueAttachment"])
    expect(READ_TOOLS).not.toContain("downloadJiraIssueAttachment")
    expect(classify("downloadJiraIssueAttachment")).toBe("export")
  })

  test("the three reads the pinned scope does not grant are reads, and are not tools RPC methods", () => {
    expect([...NOT_GRANTED_TOOLS]).toEqual(["getJiraScreen", "getJiraWorkflowEditorLink", "getJiraWorkflows"])
    for (const tool of NOT_GRANTED_TOOLS) expect(classify(tool)).toBe("read")
    // They sit in Atlassian's manage_jira group, which the sign-in does not request, so they never arrive.
    expect(NOT_GRANTED_TOOLS.filter((tool) => !READ_TOOLS.includes(tool))).toEqual([])
  })
})
