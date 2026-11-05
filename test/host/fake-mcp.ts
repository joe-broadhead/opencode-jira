// A loopback Streamable-HTTP MCP server. By default it lists two known reads, every known write, the seven denied tools
// and one tool the plugin has never seen. With `catalog: "jira"` it lists every tool in src/jira-tools.ts and the new
// tool. It answers JSON-RPC POSTs with plain JSON (no SSE stream) and records every tool call, its path and every
// request header. A `tools/call` answers with the tool's name, the path and its arguments as structured content; for the
// two account reads it answers with a fake user and two fake sites; for a `query` that starts with "text", with text
// alone; or, for a `query` that starts with "fail", with an upstream error (`isError`) whose first line holds a signed
// URL.
//
// While `challenge` is set, every MCP request gets 401 with the bearer challenge Atlassian's server sends, and the same
// server plays Atlassian's sign-in server: protected-resource metadata, and an authorization server at `/oidc` that
// registers clients dynamically (no client ID metadata documents), records each registration, and has no device grant.
// It is also an LM Studio-compatible model API for a scripted model (`model.script`), so a host test can run a real
// session turn that calls Jira's tools.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { DENY_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/jira-tools.js"

const schema = { type: "object", properties: { query: { type: "string" } } }
/** A tool the plugin has never seen. */
export const NEW_TOOL = { name: "shiny_new_tool", description: "A tool added upstream after the tool lists were written", annotations: {} }
const tool = (name: string, readOnlyHint: boolean) => ({ name, description: `Jira ${name}`, annotations: { readOnlyHint }, inputSchema: schema })
/** The two known reads the default list holds, and the pack test's two free-form read methods. */
export const READ_A = "searchJiraIssuesUsingJql"
export const READ_B = "getJiraIssue"
/** The two account reads the host suite calls, which fill the Account and Sites rows. */
export const ACCOUNT_READS = ["atlassianUserInfo", "getAccessibleAtlassianResources"]
const TOOLS = [...[READ_A, READ_B, ...ACCOUNT_READS].map((name) => tool(name, true)), ...WRITE_TOOLS.map((name) => tool(name, false)), ...DENY_TOOLS.map((name) => tool(name, false)), { ...NEW_TOOL, inputSchema: schema }]
const CATALOG = [...READ_TOOLS.map((name) => tool(name, true)), ...[...WRITE_TOOLS, ...DENY_TOOLS].map((name) => tool(name, false)), { ...NEW_TOOL, inputSchema: schema }]

/** The upstream error a "fail" query gets: two lines, the first with a signed URL. */
export const UPSTREAM_FAILURE = "Jira refused https://api.atlassian.com/a.pdf?signature=fake-signature-123 for this input\nTraceback: second line"

/**
 * The scope the plugin pins. Atlassian's 401 names none, so this value comes from the plugin's server entry, not from the
 * challenge: the tests assert that it reaches both the registration and the authorization request.
 */
import { OAUTH_SCOPE } from "../../src/constants.js"
export const ATLASSIAN_SCOPES = OAUTH_SCOPE

export interface FakeMcpOptions {
  /** `jira` lists every tool the plugin knows, and the new tool. */
  readonly catalog?: "jira"
  /**
   * Whether the token endpoint issues a refresh token. Without one, a 401 later needs a new sign-in and leaves the
   * credential in place, as Jira does when it issues no refresh token.
   */
  readonly refreshTokens?: boolean
}

/** The scripted model's id, as the fake's model API lists it. */
export const MODEL_ID = "fake-model"

/** A tool call the scripted model makes: the n-th call follows n tool results. */
interface ScriptedCall {
  readonly tool: string
  readonly arguments: Record<string, unknown>
}

export interface FakeMcp {
  readonly url: string
  /**
   * While true, every MCP request gets 401 with a bearer challenge, as Jira's server answers before a sign-in or after
   * its tokens are revoked. The sign-in server and the model API keep answering.
   */
  challenge: boolean
  /** The server's origin; `${origin}/v1` is the model API and `${origin}/oidc` the authorization server. */
  readonly origin: string
  readonly model: {
    /** The calls the model makes, one per turn, before it answers with text. */
    script: ScriptedCall[]
    /** Every chat request body, in order. */
    readonly requests: unknown[]
  }
  /** Every dynamic client registration's body, in order. */
  readonly registrations: Record<string, unknown>[]
  /** Every token request's form, in order. */
  readonly tokens: Record<string, string>[]
  /** Tool names called, in order. */
  readonly calls: string[]
  /** Each tool call with the path it was sent to, in order. */
  readonly called: { readonly tool: string; readonly path: string }[]
  /** The `x-jira-test` header of every MCP request, to tell whose server config the host used. */
  readonly markers: (string | undefined)[]
  /** The `authorization` header of every MCP request. */
  readonly authorizations: (string | undefined)[]
  close(): Promise<void>
}

type Message = { jsonrpc: "2.0"; id?: number | string; method: string; params?: { protocolVersion?: string; name?: string; arguments?: { query?: unknown } } }

export async function startFakeMcp(options: FakeMcpOptions = {}): Promise<FakeMcp> {
  const calls: string[] = []
  const called: { tool: string; path: string }[] = []
  const markers: (string | undefined)[] = []
  const authorizations: (string | undefined)[] = []
  const registrations: Record<string, unknown>[] = []
  const tokens: Record<string, string>[] = []
  let codes = 0
  const answer = (message: Message, path: string) => {
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id: message.id, result })
    switch (message.method) {
      case "initialize":
        return reply({ protocolVersion: message.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake-jira", version: "0.0.0" } })
      case "tools/list":
        return reply({ tools: options.catalog === "jira" ? CATALOG : TOOLS })
      case "tools/call": {
        const name = message.params?.name ?? ""
        calls.push(name)
        called.push({ tool: name, path })
        const args = message.params?.arguments ?? {}
        if (String(args.query ?? "").startsWith("fail")) return reply({ content: [{ type: "text", text: UPSTREAM_FAILURE }], isError: true })
        if (String(args.query ?? "").startsWith("text")) return reply({ content: [{ type: "text", text: `text from ${name}` }] })
        // The two account reads: a display name with an email beside it, and two sites with cloud ids and URLs, so a test
        // can show that status keeps the first and the names, and nothing else.
        if (name === "atlassianUserInfo") {
          return reply({ content: [{ type: "text", text: "account" }], structuredContent: { account_id: "fake-account-1", name: "Sam Okafor", email: "sam.okafor@example.com", picture: "https://avatar.example/u/1" } })
        }
        if (name === "getAccessibleAtlassianResources") {
          return reply({
            content: [{ type: "text", text: "sites" }],
            // MCP requires an object as structured content, so the sites sit under a key.
            structuredContent: {
              sites: [
                { id: "cloud-acme", url: "https://acme.atlassian.net", name: "Acme", scopes: ["read:jira-work"] },
                { id: "cloud-sandbox", url: "https://sandbox.atlassian.net", name: "Sandbox" },
              ],
            },
          })
        }
        return reply({ content: [{ type: "text", text: `called ${name}` }], structuredContent: { tool: name, path, arguments: args } })
      }
      case "ping":
        return reply({})
      default:
        return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } }
    }
  }
  const model = { script: [] as ScriptedCall[], requests: [] as unknown[] }
  // Filled once the server listens; the request handler reads `challenge`, `url` and `origin` from it.
  const fake = { challenge: false } as FakeMcp
  /**
   * One streamed chat completion. A request that offers tools is an agent turn: after n tool results the model makes
   * the n-th scripted call, then answers "Done.". Any other request, such as a title, gets text.
   */
  const chat = (response: ServerResponse, body: string) => {
    const request = JSON.parse(body) as { tools?: unknown[]; messages?: { role: string }[] }
    model.requests.push(request)
    const results = (request.messages ?? []).filter((message) => message.role === "tool").length
    const call = request.tools?.length ? model.script[results] : undefined
    const chunk = (delta: unknown, finish: string | null) =>
      `data: ${JSON.stringify({ id: "chatcmpl-fake", object: "chat.completion.chunk", created: 0, model: MODEL_ID, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    const usage = `data: ${JSON.stringify({ id: "chatcmpl-fake", object: "chat.completion.chunk", created: 0, model: MODEL_ID, choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`
    const delta = call
      ? { role: "assistant", tool_calls: [{ index: 0, id: `call_${results + 1}`, type: "function", function: { name: call.tool, arguments: JSON.stringify(call.arguments) } }] }
      : { role: "assistant", content: "Done." }
    response.writeHead(200, { "content-type": "text/event-stream" })
    response.end(`${chunk(delta, null)}${chunk({}, call ? "tool_calls" : "stop")}${usage}data: [DONE]\n\n`)
  }
  /** Jira's sign-in server, in its shape: the resource's metadata, and an authorization server at `/oidc`. */
  const signIn = async (request: IncomingMessage, response: ServerResponse, route: string) => {
    const json = (status: number, body: unknown) => void response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body))
    const issuer = `${fake.origin}/oidc`
    if (route.startsWith("/.well-known/oauth-protected-resource")) {
      return json(200, { resource: fake.url, authorization_servers: [issuer], scopes_supported: ATLASSIAN_SCOPES.split(" "), bearer_methods_supported: ["header"] })
    }
    if (["/.well-known/oauth-authorization-server/oidc", "/.well-known/openid-configuration/oidc", "/oidc/.well-known/openid-configuration", "/oidc/.well-known/oauth-authorization-server"].includes(route)) {
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/auth`,
        token_endpoint: `${issuer}/token`,
        registration_endpoint: `${issuer}/reg`,
        response_types_supported: ["code"],
        grant_types_supported: ["implicit", "authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
        scopes_supported: ATLASSIAN_SCOPES.split(" "),
      })
    }
    // Like a signed-in browser: the authorization endpoint sends the loopback callback a code, and the token endpoint
    // exchanges it for an access token and a refresh token.
    if (route === "/oidc/auth") {
      const query = new URL(request.url ?? "/", "http://127.0.0.1").searchParams
      const target = new URL(query.get("redirect_uri") ?? "/")
      target.searchParams.set("code", `fake-code-${++codes}`)
      if (query.get("state")) target.searchParams.set("state", query.get("state")!)
      return void response.writeHead(302, { location: target.toString() }).end()
    }
    if (route === "/oidc/token" && request.method === "POST") {
      const form = Object.fromEntries(new URLSearchParams(await read(request)))
      tokens.push(form)
      // While the server challenges, a refresh is refused like a revoked token: the person must sign in again.
      if (fake.challenge && form.grant_type === "refresh_token") return json(400, { error: "invalid_grant" })
      return json(200, {
        access_token: `fake-access-${tokens.length}`,
        token_type: "Bearer",
        expires_in: 3600,
        ...(options.refreshTokens === false ? {} : { refresh_token: `fake-refresh-${tokens.length}` }),
        scope: ATLASSIAN_SCOPES,
      })
    }
    if (route === "/oidc/reg" && request.method === "POST") {
      const body = JSON.parse(await read(request)) as Record<string, unknown>
      registrations.push(body)
      return json(201, { ...body, client_id: `fake-client-${registrations.length}`, client_id_issued_at: 0 })
    }
    return json(404, { error: "not_found" })
  }
  const server = createServer(async (request, response) => {
    const route = new URL(request.url ?? "/", "http://127.0.0.1").pathname
    if (route === "/api/v1/models") {
      const models = [{ type: "llm", key: MODEL_ID, display_name: "Fake model", loaded_instances: [], max_context_length: 32_000, capabilities: { vision: false, trained_for_tool_use: true } }]
      return void response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ models }))
    }
    if (route === "/v1/chat/completions") return chat(response, await read(request))
    if (route.startsWith("/.well-known/") || route.startsWith("/oidc")) return signIn(request, response, route)
    markers.push(header(request, "x-jira-test"))
    authorizations.push(header(request, "authorization"))
    if (fake.challenge) {
      const metadata = `${fake.origin}/.well-known/oauth-protected-resource`
      return void response
        // Atlassian's 401 names no scope, which is why the plugin pins one.
        .writeHead(401, { "content-type": "application/json", "www-authenticate": `Bearer resource_metadata="${metadata}"` })
        .end(JSON.stringify({ error: "invalid_token" }))
    }
    if (request.method !== "POST") return void response.writeHead(405, { allow: "POST" }).end()
    const body = JSON.parse(await read(request)) as Message | Message[]
    const replies = (Array.isArray(body) ? body : [body]).filter((message) => message.id !== undefined).map((message) => answer(message, route))
    if (!replies.length) return void response.writeHead(202).end()
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(Array.isArray(body) ? replies : replies[0]))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  Object.assign(fake, {
    url: `http://127.0.0.1:${port}/mcp`,
    origin: `http://127.0.0.1:${port}`,
    model,
    registrations,
    tokens,
    calls,
    called,
    markers,
    authorizations,
    close: () => new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve()))),
  })
  return fake
}

const header = (request: IncomingMessage, name: string) => [request.headers[name]].flat()[0]

async function read(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf8")
}
