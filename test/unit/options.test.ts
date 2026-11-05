import { describe, expect, test } from "bun:test"
import { parseOptions } from "../../src/options.js"

describe("parseOptions", () => {
  test("defaults to a tested host only", () => {
    expect(parseOptions(undefined)).toEqual({ allowUntestedHost: false })
    expect(parseOptions({})).toEqual({ allowUntestedHost: false })
  })

  test("accepts every documented value", () => {
    expect(parseOptions({ allowUntestedHost: true })).toEqual({ allowUntestedHost: true })
    expect(parseOptions({ allowUntestedHost: false })).toEqual({ allowUntestedHost: false })
  })

  test.each([
    [{ access: "write" }, 'Unknown option "access". Accepted options: "allowUntestedHost"'],
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
      expect(nextStep).toContain(`"options": { "allowUntestedHost": true }`)
      expect(message.endsWith(`. Next step: ${nextStep}`)).toBe(true)
      expect(message).not.toContain("sk-fake-000")
      expect(nextStep.endsWith(".")).toBe(true)
    }
  })
})
