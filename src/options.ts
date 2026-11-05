import { jiraError } from "./constants.js"

interface Options {
  /** Run on an OpenCode version outside the supported range, with a warning in status. */
  readonly allowUntestedHost: boolean
}

const EXAMPLE = `"plugins": [{ "package": "@joe-broadhead/opencode-jira", "options": { "allowUntestedHost": true } }]`
const ACCEPTED = {
  allowUntestedHost: "true or false (the default)",
} as const

const invalid = (problem: string) =>
  jiraError("OPTIONS_INVALID", `${problem}.`, `Fix the plugin options in opencode.json, for example ${EXAMPLE}.`)

/** Validates the plugin options from opencode.json. Every option is optional. */
export function parseOptions(raw: unknown): Options {
  if (raw === undefined || raw === null) return { allowUntestedHost: false }
  if (typeof raw !== "object" || Array.isArray(raw)) throw invalid(`The plugin options must be an object, found ${describe(raw)}`)
  const input = raw as Record<string, unknown>
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(ACCEPTED, key)) {
      throw invalid(`Unknown option "${key}". Accepted options: ${Object.keys(ACCEPTED).map((name) => `"${name}"`).join(", ")}`)
    }
  }
  const { allowUntestedHost = false } = input
  if (typeof allowUntestedHost !== "boolean") {
    throw invalid(`The option "allowUntestedHost" must be ${ACCEPTED.allowUntestedHost}, found ${describe(allowUntestedHost)}`)
  }
  return { allowUntestedHost }
}

const describe = (value: unknown) =>
  value === null ? "null" : Array.isArray(value) ? "an array" : typeof value === "string" ? JSON.stringify(value) : typeof value === "object" ? "an object" : String(value)
