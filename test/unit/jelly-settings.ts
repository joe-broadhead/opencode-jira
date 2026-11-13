/**
 * Jelly's plugin setting contract, restated for tests without zod. `PluginSettingSchema` (a strict object and its
 * refinements), `settingChoices` and `settingValueIssue` follow we-the-rebel-alliance/app
 * protocol/contracts/src/plugin-setting.ts and plugin-setting.light.ts (master 6af624591, which includes app#1301,
 * 34274b8c7); the last two are copied as they are. Jelly reads `jelly.contributes.settings` with that schema: every
 * object in it is strict, so a Jelly before app#1301, which does not know `enum` or `choices`, refuses the whole
 * declaration. Keep the rules Jelly's; never loosen them here. `ACCESS_CHOICES` is Jelly's wording for the shared
 * `access` option, word for word.
 */

/** The longest value a setting may carry, a secret included. */
export const PLUGIN_SETTING_MAX_LENGTH = 8192

export interface PluginSettingChoice {
  readonly value: string
  readonly label?: string
  readonly description?: string
}

export interface PluginSetting {
  readonly key: string
  readonly label: string
  readonly type: "string" | "boolean" | "number" | "secret"
  readonly description: string
  readonly enum?: readonly string[]
  readonly choices?: readonly PluginSettingChoice[]
  readonly min?: number
  readonly max?: number
  readonly step?: number
  readonly integer?: boolean
  readonly visibleWhen?: { readonly setting: string; readonly equals: string | boolean | number }
  readonly default?: string | boolean | number
}

type Bounds = Pick<PluginSetting, "enum" | "choices" | "min" | "max" | "step" | "integer">

/** The closed set a string setting declares, as choices; undefined for free values. */
export function settingChoices(setting: Bounds): readonly PluginSettingChoice[] | undefined {
  return setting.choices ?? (setting.enum === undefined ? undefined : setting.enum.map(value => ({ value })))
}

/** Why a value does not fit the setting's declared set or bounds, or null when it does. Jelly refuses with this. */
export function settingValueIssue(setting: Bounds, value: string | number | boolean): string | null {
  const closed = settingChoices(setting)
  if (closed !== undefined && typeof value === "string" && !closed.some(c => c.value === value)) return "not one of the declared values"
  if (typeof value !== "number") return null
  if (setting.integer === true && !Number.isInteger(value)) return "not a whole number"
  if (setting.min !== undefined && value < setting.min) return "below the minimum"
  if (setting.max !== undefined && value > setting.max) return "above the maximum"
  if (setting.step !== undefined) {
    const from = setting.min ?? 0
    const steps = (value - from) / setting.step
    if (Math.abs(steps - Math.round(steps)) > 1e-9) return "not on a step"
  }
  return null
}

const ID = /^[a-zA-Z][a-zA-Z0-9._-]{0,127}$/
const SETTING_KEYS = ["key", "label", "type", "description", "enum", "choices", "min", "max", "step", "integer", "visibleWhen", "default"]
const CHOICE_KEYS = ["value", "label", "description"]
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown, min: number, max: number) => typeof value === "string" && value.length >= min && value.length <= max
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value)
const settingValue = (value: unknown) => text(value, 0, PLUGIN_SETTING_MAX_LENGTH) || typeof value === "boolean" || typeof value === "number"

/** What Jelly's `PluginSettingSchema` refuses in one setting, as `key: problem`. */
export function settingProblems(raw: unknown): string[] {
  if (!isObject(raw)) return ["a setting must be an object"]
  const at = typeof raw.key === "string" ? raw.key : "(no key)"
  const problems: string[] = []
  const say = (problem: string) => problems.push(`${at}: ${problem}`)
  for (const key of Object.keys(raw)) if (!SETTING_KEYS.includes(key)) say(`unknown field ${key}`)
  if (typeof raw.key !== "string" || !ID.test(raw.key)) say("key must be an identifier")
  if (!text(raw.label, 1, 200)) say("label must be 1 to 200 characters")
  if (!["string", "boolean", "number", "secret"].includes(raw.type as string)) say("type must be string, boolean, number or secret")
  if (!text(raw.description, 0, 1000)) say("description must be at most 1000 characters")
  if (raw.enum !== undefined && !(Array.isArray(raw.enum) && raw.enum.length >= 2 && raw.enum.length <= 64 && raw.enum.every(value => text(value, 1, 200))))
    say("enum must be 2 to 64 values of 1 to 200 characters")
  if (raw.choices !== undefined) {
    const valid = Array.isArray(raw.choices) && raw.choices.length >= 2 && raw.choices.length <= 64 && raw.choices.every(choice =>
      isObject(choice) && Object.keys(choice).every(key => CHOICE_KEYS.includes(key)) && text(choice.value, 1, 200) &&
      (choice.label === undefined || text(choice.label, 1, 200)) && (choice.description === undefined || text(choice.description, 0, 300)))
    if (!valid) say("choices must be 2 to 64 entries of value (1 to 200), label (1 to 200) and description (at most 300) only")
  }
  for (const key of ["min", "max", "step"]) if (raw[key] !== undefined && !finite(raw[key])) say(`${key} must be a finite number`)
  if (raw.step !== undefined && !((raw.step as number) > 0)) say("step must be positive")
  if (raw.integer !== undefined && typeof raw.integer !== "boolean") say("integer must be true or false")
  if (raw.visibleWhen !== undefined) {
    const when = raw.visibleWhen
    if (!isObject(when) || Object.keys(when).some(key => key !== "setting" && key !== "equals") || typeof when.setting !== "string" || !ID.test(when.setting) || !settingValue(when.equals))
      say("visibleWhen must be { setting, equals } only")
  }
  if (raw.default !== undefined && !settingValue(raw.default)) say("default must be a string, boolean or number")
  if (problems.length > 0) return problems

  const setting = raw as unknown as PluginSetting
  if (setting.default !== undefined && (setting.type === "secret" || typeof setting.default !== setting.type))
    say("A default must match the setting type; secrets never declare a default")
  const closed = settingChoices(setting)
  if (setting.enum !== undefined && setting.choices !== undefined) say("Declare a closed set as enum or as choices, not both")
  if (closed !== undefined) {
    if (setting.type !== "string") say("Only a string setting has a closed set")
    if (new Set(closed.map(choice => choice.value)).size !== closed.length) say("The values of a closed set must be unique")
    if (typeof setting.default === "string" && !closed.some(c => c.value === setting.default)) say("A default must be one of the closed set's values")
  }
  const bounded = setting.min !== undefined || setting.max !== undefined || setting.step !== undefined || setting.integer !== undefined
  if (bounded && setting.type !== "number") say("Only a number setting has min, max, step or integer")
  if (setting.min !== undefined && setting.max !== undefined && setting.min > setting.max) say("min may not be above max")
  if (typeof setting.default === "number" && settingValueIssue(setting, setting.default) !== null) say("A default must satisfy the setting's own bounds")
  return problems
}

/** Every problem Jelly's schema finds in `contributes.settings` (an array of at most 32); empty when Jelly reads them. */
export function settingsProblems(settings: unknown): string[] {
  if (!Array.isArray(settings)) return ["settings must be an array"]
  return [...(settings.length > 32 ? ["at most 32 settings"] : []), ...settings.flatMap(settingProblems)]
}

/** Jelly's choices for the shared `access` option, verbatim (app#172). */
export const ACCESS_CHOICES: readonly PluginSettingChoice[] = [
  { value: "all", label: "Allowed", description: "Every tool runs without asking, reads and changes alike." },
  { value: "ask-changes", label: "Ask before changes", description: "Reads run without asking. Each change asks you first." },
  { value: "read-only", label: "Read only", description: "Reads run. Changes never run." },
]
