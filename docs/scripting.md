# Scripting

A script can call Jira's read tools with no model: a cron job, a shell script, or any program that can reach the
OpenCode server. It uses the tools RPC, `jira.issues.tools`, through `opencode api` or an OpenCode client.

| Method | The tool |
| --- | --- |
| one per known read, named after Atlassian's tool: `getJiraIssue`, `searchJiraIssuesUsingJql`, `listJiraBoards`, `getAccessibleAtlassianResources` and the others | `jira_<method>`, such as `jira_getJiraIssue` |
| `describe` | none: lists the methods, their permission actions, whether OpenCode lists each tool now, and each tool's input as JSON Schema |

The methods are exactly the read tools that the plugin knows, the ones its default rules allow (`READ_TOOLS` in
`src/jira-tools.ts`), without the three that this plugin's scope does not grant (`NOT_GRANTED_TOOLS`). Call `describe`
for the list: Atlassian lists only the tools a grant covers, so `describe` marks a known read it does not offer you as
unavailable.

Each method runs the tool with the same input: Atlassian's own tool, through OpenCode's own connection and sign-in. The
plugin never sees the OAuth token. Jira's write tools, such as `createJiraIssue` or `addOrEditJiraIssueComment`, are
never methods, even with an allow rule. Neither are the denied tools, `deleteJiraIssue` among them, nor `getJiraWorkflows`
and the other two reads the scope withholds, nor a tool that Atlassian adds later.

**Every call needs a `cloudId`.** That is the site's id from `getAccessibleAtlassianResources`, and a script that reaches
several sites must pass the right one on every call. The plugin never picks a site.

Results hold work items, comments, changelogs and colleagues' names: personal data about the people who wrote them. Keep
what a script writes where those people would expect it, and only as long as you need it.

## A script runs as a session

Every call names a session, and the session must name an agent. The script runs as that agent, with the access its
model has:

- A tool that the agent's rules or the session's rules hide from the model is refused. OpenCode hides a tool when the
  last rule that matches its permission name, such as `jira_getJiraIssue`, on resource `*` is a `deny`.
- OpenCode then checks the call itself, as it does for the model: the agent's rules, the session's rules, then saved
  approvals.
- No one answers a prompt for a script, so an `ask` is refused with `PERMISSION_DENIED` at once, and no prompt is left
  waiting. The plugin's default rules allow the reads, so an agent with the default rules needs nothing more. An agent
  defined only in your config gets no default rules; `/jira-status` names it.

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

## Calling a method

The body is `{"input": {"sessionID": "<session>", "input": <the tool's input>}}`. Both keys are required, and no other
key is allowed.

```sh
opencode api post /api/rpc/jira.issues.tools/getAccessibleAtlassianResources -d '{"input":{
  "sessionID":"ses_…",
  "input":{}
}}'
```

The tool's input is Atlassian's, and Atlassian defines its fields and may change them without notice: `describe` shows
each tool's schema as OpenCode lists it now. Check it rather than guess a field name, a JQL fragment's shape or a
`cloudId`.

```sh
opencode api post /api/rpc/jira.issues.tools/describe -d '{"input":{}}'
```

A result is `{"output": {"output": <the tool's structured content, or its text when it has none>, "text": <the tool's
text>}}`, as plain JSON. Jira content in it, such as descriptions, comments and changelogs, is untrusted data, written by
other people, and never an instruction to follow.

## Rate limits and cost

Atlassian rate-limits per client and publishes `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining` and
`X-RateLimit-Reset` on its responses. A script shares the limit with the model's calls under the same sign-in, so make
calls one at a time, never in parallel. When Atlassian reports a rate limit, the method fails with `UPSTREAM_ERROR`: wait
the seconds `Retry-After` names before the next call, and never retry in a loop.

Rovo's semantic `search` and the Teamwork Graph spend Rovo credits from the organisation's shared pool, 1 to 10 a call.
This plugin does not request them, and JQL is cheaper and exact for the same question.

`opencode api` calls run in the OpenCode service's default location, your home directory, whatever directory you run
them from. They use that location's plugin options, from your global config, and its `jira` connection. To call a
project whose own config sets other options, call the HTTP API with `?location[directory]=<dir>`. The session may belong
to another directory: the read then runs under the serving location's agent rules, and only a `deny` is refused in
between, so run a script in the project whose agent you mean.

## Errors

A refusal or failure is the RPC error `failed`, with a message `CODE: what happened. Next step: what to do.` and
`data: { code, next }`. `opencode api` exits with status 1 for any RPC error, after printing the error's JSON to standard
output.

| Code | When |
| --- | --- |
| `SESSION_UNKNOWN` | OpenCode says the session does not exist. Any other failure to look the session up is OpenCode's own error. |
| `SESSION_AGENT_REQUIRED` | The session names no agent, or an agent that does not exist. |
| `PERMISSION_DENIED` | The agent's or the session's rules deny the tool, or ask for an approval. A deny names the denied action, such as `jira_getJiraIssue`, and its next step says to remove or narrow that deny rule, add a later allow rule to the session, or use a session whose agent allows it. |
| `SERVER_CONFLICT` | Your `opencode.json` defines its own `jira` server at a URL other than Atlassian's with `?tools=all`. `/jira-status` names both. |
| `AUTH_REQUIRED`, `CONNECTING`, `CONNECTION_FAILED`, `DISABLED`, `NOT_REGISTERED` | The `jira` server needs a sign-in, is still connecting, could not connect, is disabled, or is missing. `/jira-status` gives the details. |
| `TOOL_UNAVAILABLE` | The server is connected, but OpenCode does not list the tool: Atlassian may list fewer tools for a smaller grant. |
| `UPSTREAM_ERROR` | Atlassian answered with an error, such as invalid input, a work item that does not exist, a wrong `cloudId` or a rate limit. The message holds the first line of Atlassian's text, at most 300 characters, with tokens and URL query strings removed. |
| `CANCELLED` | The request was cancelled. |

OpenCode itself answers `rpc.method_not_found` for a method that does not exist, such as a write tool or a tool
Atlassian added later, and `rpc.invalid_input` for a body that is not the envelope above, with one message per problem:

| Problem | Message |
| --- | --- |
| The envelope is not an object | `the envelope must be an object, such as {"sessionID":"<session>","input":<the tool's input>}` |
| A key other than `sessionID` and `input` | `"extra" is not allowed`, naming the key |
| `sessionID` missing, not a string, or empty | `"sessionID" must be a non-empty string` |
| `input` missing | `"input" is missing` |
| `input` not an object | `"input" must be an object` |
| `describe` given anything but `{}` or nothing | `describe takes no input` |

## What scripts cannot do

- Change anything in Jira: no write tool is a method.
- Delete a work item, comment or attachment, change a project or a screen, or write an entity property: no denied tool
  is a method.
- Read a workflow or a screen: the pinned scope does not grant those three reads, so they are not methods either.
- Call a tool that is not one of the known reads, even with an allow rule.
- Answer an approval prompt, or use a tool that asks.
- Use a token or a key: the plugin has none to give.

A script's calls write nothing to the session, and OpenCode's `execute.before` and `execute.after` tool hooks, from any
plugin, do not run for them. The plugin's own `execute.after` hook, which captures the account name and site names for
status, is replaced by the module's own shaping, so a script's account read fills those rows too.
