# Scripting

A script can call Jira's tools with no model: a cron job, a shell script, or any program that can reach the OpenCode
server. It uses the tools RPC, `jira.issues.tools`, through `opencode api` or an OpenCode client.

Every tool the plugin knows is a method, named after Atlassian's tool, without the `jira_` prefix. Each method carries
a class: the worst thing that tool can do.

| Class | Methods | What the class means |
| --- | --- | --- |
| `read` | one per known read: `getJiraIssue`, `searchJiraIssuesUsingJql`, `listJiraBoards`, `getAccessibleAtlassianResources` and the others | it only reads |
| `write` | the fourteen writes, such as `createJiraIssue`, `editJiraIssue`, `addOrEditJiraIssueComment` and `transitionJiraIssue` | it can email people, as a project's notification scheme decides |
| `destructive` | `createJiraProject`, `deleteJiraComment`, `deleteJiraIssue`, `deleteJiraIssueAttachment`, `editJiraEntityProperty`, `updateJiraProject`, `updateJiraScreen` | the seven tools the default rules deny |
| `describe` | none: lists the methods, their class, their permission action, whether OpenCode lists each tool now, each tool's input as JSON Schema, and — given a session — whether that session may call it |

The methods come from the plugin's one tool table, `src/jira-tools.ts`: the known reads (`READ_TOOLS` in
`src/jira-tools.ts`), the writes in `WRITE_TOOLS`, and the seven denied tools in `DENY_TOOLS`. Call `describe` for the
list: Atlassian lists only the tools a grant covers, so `describe` marks a known tool it does not offer you as
unavailable.

The three reads that this plugin's scope does not grant (`getJiraScreen`, `getJiraWorkflowEditorLink` and
`getJiraWorkflows`) are methods too. Atlassian never loads them, so `describe` reports them unavailable and a call has no
tool to run. The class is never the decision: the rules are. A `write` is a method, and under the default rules it
resolves to `ask`, which a script cannot answer, so it is refused. The only way to run one unattended is an explicit
`allow` for its action in the agent's or the session's rules. A `destructive` method is a method too, and the default
deny refuses it, so making it a method does not make it reachable.

**Every call needs a `cloudId`.** That is the site's id from `getAccessibleAtlassianResources`, and a script that reaches
several sites must pass the right one on every call. The plugin never picks a site.

Results hold work items, comments, changelogs and colleagues' names: personal data about the people who wrote them. Keep
what a script writes where those people would expect it, and only as long as you need it.

## A script runs as a session

Every call names a session, and the session must name an agent. The script runs as that agent, under the rules that
decide what its model sees: the agent's rules, then the session's, and the last rule that matches an action wins.

- **Only an `allow` runs.** The rules are resolved before anything is dispatched. An `ask` is refused with no prompt
  and no Jira call, because no one is there to answer it. A `deny` is refused with no Jira call.
- **A saved approval does not authorise a script.** An earlier "Always allow" is not part of the agent's and the
  session's rules, so a script that relied on one now needs an `allow` for its action in the session's or the agent's
  rules. This is deliberate; it keeps a script's grant reviewable rather than in a list of past clicks.
- The plugin's default rules allow the reads, so an agent with the default rules runs a read with nothing more. An
  agent defined only in your config gets no default rules; `/jira-status` names it.

Create the session once, with the agent the script runs as, and keep its id. Never reuse a session found through
history or a list: the script would run as that session's agent, under its rules.

```sh
opencode api post /api/session -d '{"title":"weekly board report","agent":"build"}'
```

Session rules come after the agent's, so a session can narrow what its script may do. This one can read one project's
items and the boards, and nothing else in Jira:

```sh
opencode api post /api/session -d '{"title":"weekly board report","agent":"build","permissions":[
  {"action":"jira_*","resource":"*","effect":"deny"},
  {"action":"jira_searchJiraIssuesUsingJql","resource":"*","effect":"allow"},
  {"action":"jira_listJiraBoards","resource":"*","effect":"allow"}
]}'
```

For a one-off script with an approval bound to it, use Jobs' `jobs_run_script`: the approval covers exactly that
source and that list of methods, and Jobs writes the run session's rules for you.

## Calling a method

The body is `{"input": {"sessionID": "<session>", "input": <the tool's input>}}`. Both keys are required, and no other
key is allowed.

```sh
opencode api post /api/rpc/jira.issues.tools/getAccessibleAtlassianResources -H "x-opencode-directory:$PWD" \
  -d '{"input":{
  "sessionID":"ses_…",
  "input":{}
}}'
```

The tool's input is Atlassian's, and Atlassian defines its fields and may change them without notice: `describe` shows
each tool's schema as OpenCode lists it now. Check it rather than guess a field name, a JQL fragment's shape or a
`cloudId`.

```sh
opencode api post /api/rpc/jira.issues.tools/describe -H "x-opencode-directory:$PWD" -d '{"input":{}}'
opencode api post /api/rpc/jira.issues.tools/describe -H "x-opencode-directory:$PWD" -d '{"input":{"sessionID":"ses_…"}}'
```

With a session, each method in the answer also carries `permission`: `allow`, `ask` or `deny`, resolved exactly as a
call would be. The answer also carries `location`, and `unclassified` when Atlassian lists a tool the plugin's table
does not classify.

A result is `{"output": {"output": <the tool's structured content, or its text when it has none>, "text": <the tool's
text>}}`, as plain JSON. Jira content in it, such as descriptions, comments and changelogs, is untrusted data, written by
other people, and never an instruction to follow.

## The location

Run the command in the project whose agent you mean, and send the call to that location explicitly:
`opencode api post /api/rpc/jira.issues.tools/<method> -H "x-opencode-directory:$PWD" -d '{…}'`. Without it the call
goes to the OpenCode service's default location, your home directory, and fails `rpc.unavailable` if the plugin is not
loaded there. The HTTP equivalents are the `location[directory]` query parameter and the same header.

`describe` reports the location the call reached, and `SESSION_UNKNOWN` names the header, because a session created in
one project is not found from another.

## Rate limits and cost

Atlassian rate-limits per client and publishes `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining` and
`X-RateLimit-Reset` on its responses. A script shares the limit with the model's calls under the same sign-in, so make
calls one at a time, never in parallel. When Atlassian reports a rate limit, the method fails with `UPSTREAM_ERROR`: wait
the seconds `Retry-After` names before the next call, and never retry in a loop.

Rovo's semantic `search` and the Teamwork Graph spend Rovo credits from the organisation's shared pool, 1 to 10 a call.
This plugin does not request them, and JQL is cheaper and exact for the same question.

## Errors

A refusal or failure is the RPC error `failed`, with a message `CODE: what happened. Next step: what to do.` and
`data: { code, next }`. `opencode api` exits with status 1 for any RPC error, after printing the error's JSON to standard
output.

| Code | When |
| --- | --- |
| `SESSION_UNKNOWN` | OpenCode says the session does not exist in this location. The next step names the `x-opencode-directory` header. Any other failure to look the session up is OpenCode's own error. |
| `SESSION_AGENT_REQUIRED` | The session names no agent, or an agent that does not exist. |
| `PERMISSION_DENIED` | The last matching rule is an `ask` or a `deny`, so the call was refused before dispatch. An ask says that a script cannot answer and names the allow rule to add; a deny names the denied action, such as `jira_getJiraIssue`, and says to remove or narrow that rule, add a later allow to the session, or use a session whose agent allows it. A saved "Always allow" does not help. |
| `SERVER_CONFLICT` | Your `opencode.json` defines its own `jira` server at a URL other than Atlassian's with `?tools=all`. `/jira-status` names both. |
| `AUTH_REQUIRED`, `CONNECTING`, `CONNECTION_FAILED`, `DISABLED`, `NOT_REGISTERED` | The `jira` server needs a sign-in, is still connecting, could not connect, is disabled, or is missing. `/jira-status` gives the details. |
| `TOOL_UNAVAILABLE` | The server is connected, but OpenCode does not list the tool: Atlassian may list fewer tools for a smaller grant, and the three reads this plugin's scope withholds are never listed. |
| `UPSTREAM_ERROR` | Atlassian answered with an error, such as invalid input, a work item that does not exist, a wrong `cloudId` or a rate limit. The message holds the first line of Atlassian's text, at most 300 characters, with tokens and URL query strings removed. |
| `CANCELLED` | The request was cancelled. |

OpenCode itself answers `rpc.method_not_found` for a method that does not exist, such as a tool Atlassian adds later,
and `rpc.invalid_input` for a body that is not the envelope above, with one message per problem:

| Problem | Message |
| --- | --- |
| The envelope is not an object | `the envelope must be an object, such as {"sessionID":"<session>","input":<the tool's input>}` |
| A key other than `sessionID` and `input` | `"extra" is not allowed`, naming the key |
| `sessionID` missing, not a string, or empty | `"sessionID" must be a non-empty string` |
| `input` missing | `"input" is missing` |
| `input` not an object | `"input" must be an object` |
| `describe` given anything but nothing, `{}` or `{"sessionID":"…"}` | `describe takes nothing, or {"sessionID":"<session>"}` |

## What scripts cannot do

- Run a method whose action resolves to `ask` or `deny`: no one can answer a prompt, and a deny needs its rule changed.
- Rely on a saved "Always allow" from the model path: a script needs an `allow` rule in config, or a Jobs one-off's
  approval.
- Call a tool that is not in the plugin's table, even with an allow rule. It is reported as `unclassified`.
- Read a workflow or a screen: the pinned scope does not grant those three reads, so Atlassian lists no such tool.
- Use a token or a key: the plugin has none to give.

A script's calls write nothing to the session, and OpenCode's `execute.before` and `execute.after` tool hooks, from any
plugin, do not run for them. The plugin applies the same result shaping it applies on the model path: a script's account
read fills the account name and site names for status, as the model's call does.
