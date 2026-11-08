import { describe, expect, test } from "bun:test"
import { parseOptions } from "../../src/options.js"
import { ACCESS } from "../../src/permissions.js"

describe("parseOptions", () => {
  test("defaults to a tested host with every tool allowed", () => {
    expect(parseOptions(undefined)).toEqual({ allowUntestedHost: false, access: "all" })
    expect(parseOptions({})).toEqual({ allowUntestedHost: false, access: "all" })
  })

  test("accepts every documented value, and every access value", () => {
    expect(parseOptions({ allowUntestedHost: true })).toEqual({ allowUntestedHost: true, access: "all" })
    expect(parseOptions({ allowUntestedHost: false })).toEqual({ allowUntestedHost: false, access: "all" })
    for (const access of ACCESS) expect(parseOptions({ access })).toEqual({ allowUntestedHost: false, access })
  })

  test.each([
    [{ access: "write" }, 'The option "access" must be "all", "ask-changes", "read-only", with "all" the default, found "write"'],
    [{ access: null }, 'The option "access" must be'],
    [{ apiKey: "sk-fake-000" }, 'Unknown option "apiKey"'],
    [{ allowUntestedHost: "yes" }, 'The option "allowUntestedHost" must be true or false (the default), found "yes"'],
    [{ allowUntestedHost: null }, 'The option "allowUntestedHost" must be true or false (the default), found null'],
    ["read", 'The plugin options must be an object, found "read"'],
    [[], "The plugin options must be an object, found an array"],
  ])("rejects %j with the key, the accepted values and an example", (input, problem) => {
    expect(() => parseOptions(input)).toThrow(problem)
    try {
      parseOptions(input)
    } catch (error) {
      const { message, code, nextStep } = error as Error & { code: string; nextStep: string }
      expect(code).toBe("OPTIONS_INVALID")
      expect(message.startsWith("OPTIONS_INVALID: ")).toBe(true)
      expect(nextStep).toContain(`"options": { "access": "ask-changes" }`)
      expect(message.endsWith(`. Next step: ${nextStep}`)).toBe(true)
      expect(message).not.toContain("sk-fake-000")
      expect(nextStep.endsWith(".")).toBe(true)
    }
  })
})
