import type { Plugin } from "@opencode/plugin"
import { errorText, SERVER_NAME } from "./constants.js"
import { reasonOf } from "./redact.js"
import { ALL_TOOLS, classify } from "./jira-tools.js"

export interface Rule {
  readonly action: string
  readonly resource: string
  readonly effect: "allow" | "ask" | "deny"
}

/** How much the default rules restrict. `all` allows every tool; the other values restrict by the tool's class. */
export type Access = "all" | "ask-changes" | "read-only"

/** The accepted `access` values, in the order the docs and status list them. */
export const ACCESS: readonly Access[] = ["all", "ask-changes", "read-only"]

/**
 * The effect each class gets under `access`:
 * - `all`: everything is allowed, reads and changes alike;
 * - `ask-changes`: a read is allowed, and every other class asks;
 * - `read-only`: a read is allowed, and every other class is denied (a deny also hides the tool from the model).
 */
export const effectOf = (name: string, access: Access): Rule["effect"] => (classify(name) === "read" ? "allow" : access === "all" ? "allow" : access === "ask-changes" ? "ask" : "deny")

/** The host's permission action for an MCP tool of the `jira` server. */
const actionOf = (tool: string) => `${SERVER_NAME}_${tool}`
const rule = (tool: string, effect: Rule["effect"]): Rule => ({ action: actionOf(tool), resource: "*", effect })

/**
 * The block the plugin inserts, generated from the tool table and `access`. Broad first, narrow last, because the last
 * matching rule wins: the namespace pattern covers every Jira tool, including one Jira adds later, and each
 * known tool then gets its class's effect. With `access: "all"` every rule allows; `ask-changes` asks for anything but
 * a read; `read-only` denies anything but a read.
 */
export const defaultRules = (access: Access = "all"): Rule[] => [
  rule("*", access === "all" ? "allow" : access === "ask-changes" ? "ask" : "deny"),
  ...ALL_TOOLS.map((tool) => rule(tool, effectOf(tool, access))),
]

const same = (a: Rule, b: Rule) => a.action === b.action && a.resource === b.resource && a.effect === b.effect
const BASE_ALLOW: Rule = { action: "*", resource: "*", effect: "allow" }

/**
 * True when the plugin's block appears as one contiguous block anywhere after the agent's first base allow, inserted by
 * the plugin or pasted by the user. Other plugins insert their blocks at the same place, so the block need not come
 * first. False without a base allow.
 */
export function hasDefaultRules(permissions: readonly Rule[], access: Access = "all") {
  const base = permissions.findIndex((item) => same(item, BASE_ALLOW))
  if (base === -1) return false
  const rules = defaultRules(access)
  return permissions.some((_, start) => start > base && rules.every((item, offset) => permissions[start + offset] !== undefined && same(permissions[start + offset]!, item)))
}

/** The `access` a block was generated for, read back from its namespace pattern: the first rule the block holds. */
const accessOf = (rules: readonly Rule[]): Access => (rules[0]?.effect === "allow" ? "all" : rules[0]?.effect === "ask" ? "ask-changes" : "read-only")

/**
 * Splices `rules` in right after the agent's base `* * allow`, by index. Everything later still wins: the agent's
 * own stricter rules (Plan, Explore), the user's `permissions`, and saved approvals. Agents without a base allow,
 * or that already carry the rules, are left alone: there the block's pattern would loosen a default deny. Returns
 * whether it inserted.
 */
export function insertRules(permissions: Rule[], rules: readonly Rule[]) {
  if (hasDefaultRules(permissions, accessOf(rules))) return false
  const base = permissions.findIndex((item) => same(item, BASE_ALLOW))
  if (base === -1) return false
  permissions.splice(base + 1, 0, ...rules.map((item) => ({ ...item })))
  return true
}

/** Registers the default rules for every agent. Synchronous and never throws; a failure is kept for status. */
export function registerDefaultRules(
  agent: Pick<Plugin.Context["agent"], "transform">,
  rules: readonly Rule[],
  report: (problem: string | undefined) => void,
) {
  return agent.transform((editor) => {
    try {
      for (const { id } of editor.list()) editor.update(id, (info) => void insertRules(info.permissions, rules))
      report(undefined)
    } catch (error) {
      report(errorText("RULES_NOT_ADDED", `Jira's default permission rules could not be added (${reasonOf(error)}).`, "Restart OpenCode."))
    }
  })
}

const wildcard = (pattern: string) =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`)

/** The host's evaluation for an MCP call (resource `*`): the last matching rule wins, and no match asks. */
export function evaluate(permissions: readonly Rule[], action: string): Rule["effect"] {
  return permissions.findLast((item) => wildcard(item.action).test(action) && wildcard(item.resource).test("*"))?.effect ?? "ask"
}

/**
 * Agents where the plugin's block never arrived: a base allow, and no block after it, and nothing in the agent's own
 * rules that asks or denies for an Jira tool. Under `access: "all"` that is the same posture the block would give,
 * so status names none; under the other values it means the agent is unrestricted.
 */
export const unguardedAgents = (agents: readonly { readonly id: string; readonly permissions: readonly Rule[] }[], access: Access = "all") =>
  access === "all"
    ? []
    : agents
        .filter((agent) => agent.permissions.some((item) => same(item, BASE_ALLOW)) && !hasDefaultRules(agent.permissions, access))
        .filter((agent) => evaluate(agent.permissions, actionOf("new_tool")) === "allow")
        .map((agent) => agent.id)
