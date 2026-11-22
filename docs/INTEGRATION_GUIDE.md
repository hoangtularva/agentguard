# Integration guide: guarding agents in another codebase

Callwrit decides; **your app executes**. Your agent asks before each tool call and gets **ALLOW** (with a 60-second, single-use decision token), **REVIEW** (a human approves in the Approval Inbox) or **BLOCK** (with reasons). Callwrit never holds your tools' credentials and never performs your side effects.

## 1. Which method?

```
Is the agent an MCP client (Claude Desktop/Code, Cursor, an MCP-based framework)?
 ├─ yes → MCP gateway (no code changes)                                   §3.4
 └─ no  → Can you edit the code that calls tools?
           ├─ TypeScript/JavaScript → @callwrit/sdk guardTools()        §3.1
           ├─ Python                → callwrit session.guard()      §3.2
           └─ anything else         → HTTP /v1 (OpenAPI)                   §3.3
Do you also control the service that performs the side effect (mailer, payments, storage)?
 └─ yes → add the tool-side verifier: it refuses calls without a valid token   §3.5
Need decisions inside your own process, no server (tests, offline evaluation)?
 └─ @callwrit/core: evaluatePolicy + ToolSpec, pure functions               §3.6
```

| Method | Code changes | Enforcement strength | Latency per call |
|---|---|---|---|
| SDK (TS / Python) | wrap tool functions | cooperative: an agent that skips the wrapper is not checked, **unless the tool verifies tokens** | 1 HTTP round trip |
| MCP gateway | none (config) | enforced for everything that goes through the gateway | 1 round trip |
| HTTP `/v1` | call 2–3 endpoints | as SDK | 1 round trip |
| Tool-side verifier | in the tool service | **enforced**: no valid token ⇒ no side effect | offline: µs; online: 1 round trip |
| `@callwrit/core` | in process | as strong as your process | µs |

`/v1/check` latency is measured in [benchmark-v1.md](benchmark-v1.md).

## 2. Concepts you need

| Concept | Meaning |
|---|---|
| **App** | Your tenant: its own tools, agents, policy (`<app>.default`, starts as the tool-agnostic starter policy), keys and audit. |
| **ToolSpec** | JSON Schema of the arguments + `kind` (`source` reads data in, `sink` sends it out) + `risk` + argument roles: `destinationArg` (required for sinks), `resourceArg`, `contentArgs`. Unknown arguments are always rejected. |
| **Agent** | An identity with an upper bound of tools (`allowedTools`). Keys can be bound to one agent. |
| **Session** | One user task. Its **prompt is the trusted channel**: emails/URLs the user typed there are authorized destinations. Sub-agents are listed in `agents` and share the session's provenance. |
| **Source** | Content the agent saw (email, web page, document, another agent's output). Untrusted. Hand-offs between agents use `session.handoff(toAgent, message)` (type `agent_message`); `/v1/check` accepts `parentCallId` to record which call delegated the step. Privacy mode sends only its emails/URLs (fingerprints) and locally detected injection signals. |
| **Decision token** | Binds app, agent, call, tool and a canonical hash of the arguments; expires in 60 s; single use. `agt1` = HMAC (offline verification needs the shared key); `agt2` = **Ed25519** (`npm run admin -- token-alg <app> ed25519`; tools verify with the public key from `GET /v1/keys/<app>`, no secret). |

Keys and scopes: `check` (sessions, sources, check, approvals, results), `verify` (token verification, for tool services), `admin` (tools, agents). Keys are shown once and stored as SHA-256 hashes.

## 3. Quickstarts

Common setup (UI: *Apps & API keys* as an approver; or CLI):

```bash
npm run admin -- create-app myapp "My App"
npm run admin -- create-key myapp admin   --scopes admin
npm run admin -- create-key myapp runtime --scopes check
npm run admin -- create-key myapp tools   --scopes verify
```

Register tools and agents once (admin key):

```bash
curl -X PUT http://localhost:3000/v1/tools/send_email -H "authorization: Bearer $ADMIN_KEY" -H "content-type: application/json" -d '{
  "name": "send_email", "kind": "sink", "risk": "medium", "destinationArg": "to", "contentArgs": ["body"],
  "inputSchema": { "type": "object", "properties": { "to": { "type": "string", "format": "email" }, "body": { "type": "string" } }, "required": ["to", "body"] }
}'
curl -X PUT http://localhost:3000/v1/agents/writer -H "authorization: Bearer $ADMIN_KEY" -H "content-type: application/json" \
  -d '{ "name": "Writer", "allowedTools": ["send_email"] }'
```

### 3.1 TypeScript SDK
See [packages/sdk-ts](../packages/sdk-ts/README.md) and [examples/ts-multi-agent](../examples/ts-multi-agent/demo.ts).

```ts
const ag = new Callwrit({ baseUrl, apiKey: process.env.CALLWRIT_KEY! });
const session = await ag.startSession({ userRef, agentId: "researcher", agents: ["writer"], prompt: userMessage, mandate: { tools: ["read_inbox", "send_email"] } });
const tools = guardTools(session.as("writer"), { send_email: (args, ctx) => mailer.send(args, ctx.decisionToken) });
```

Vercel AI SDK / LangChain.js / your own loop: wrap the `execute` function of each tool with `session.guard(name, fn)`.

### 3.2 Python SDK
See [sdk/python](../sdk/python/README.md) and [examples/python-multi-agent](../examples/python-multi-agent/demo.py).

```python
session = ag.start_session(user_ref=user_id, agent_id="researcher", agents=["writer"], prompt=user_message, tools=["read_inbox", "send_email"])
send_email = session.as_agent("writer").guard("send_email", mailer.send)
```

LangChain / LangGraph / CrewAI / AutoGen: wrap the function the framework calls (`StructuredTool(func=session.guard(...))`, `@tool` on a guarded function, etc.).

### 3.3 Raw HTTP
[docs/openapi.json](openapi.json) (also served at `/v1/openapi.json`). The minimal loop:

1. `POST /v1/sessions` once per task → `sessionId`.
2. For each content the agent reads: `POST /v1/sessions/:id/sources` (fingerprints or content).
3. Before each tool call: `POST /v1/check` → ALLOW (run it, pass `decisionToken` to the tool), REVIEW (`GET /v1/approvals/:id` until `approved`, then `POST /v1/approvals/:id/consume` → token), BLOCK (don't run; tell the model the reasons).
4. After running: `POST /v1/calls/:id/result` (its output becomes untrusted provenance).

### 3.4 MCP gateway
See [packages/mcp-gateway](../packages/mcp-gateway/README.md) and [examples/mcp](../examples/mcp). Only tools listed in the config are exposed; the mandate comes from the config, never from the model.

### 3.5 Tool-side verifier
In the service that performs the side effect:

```ts
const verifier = new DecisionVerifier({ server: { baseUrl, apiKey: process.env.CALLWRIT_VERIFY_KEY! } }); // or { key, appId } offline
export const POST = verifier.protect("send_email", (req, args) => sendMail(args));                       // 403 without a matching token
```

```python
verifier = TokenVerifier(key=os.environ["CALLWRIT_TOKEN_KEY"], app_id="myapp")  # npm run admin -- token-key myapp
send_email = verifier.protect("send_email")(mailer.send)                            # call with callwrit_token=...
```

Offline mode enforces single use per process; use online mode for replicated tool services. With Ed25519 apps, pass `publicKey` (TS) / `public_key` (Python, needs `cryptography`) instead of the shared key: the tool service then holds no secret at all.

### 3.6 Embedded core
`@callwrit/core` exposes the pure decision point (`evaluatePolicy`), `compileToolSpec`, provenance helpers and the starter policy. No I/O, no server, no approvals or audit: use it for tests, simulations or as a building block.

### 3.7 Running Callwrit next to your app
`docker compose -f docker-compose.sidecar.yml up -d --build`: `/v1` on a private `callwrit` Docker network (your services join it), approval UI on `127.0.0.1:3001`. Packages for offline installation: `npm run package` → `dist-packages/` (three `.tgz`, one `.whl`).

### 3.8 Policies as code
Templates (starter, strict approvals, internal-only), YAML export/import and policy unit tests: [policies/README.md](../policies/README.md).

### 3.9 Approval notifications (opt-in)
`npm run admin -- webhook <app> <url>` makes Callwrit POST `approval.requested` / `approval.decided` events (ids and tool name only, never arguments), signed with `X-Callwrit-Signature: sha256=HMAC(secret, timestamp + "." + body)`; get the secret with `npm run admin -- webhook-secret <app>`. One attempt, 3 s timeout; decisions never depend on delivery. Off by default.

## 4. Safety checklist

- [ ] **Sinks declare `destinationArg`** and a realistic `risk`; free text goes in `contentArgs` (hashed in audit).
- [ ] **The session prompt is the user's own words**, not model output. Destinations you add to `mandate.destinations` must come from your UI/config, never from the model.
- [ ] **Everything the agent reads is registered** as a source (SDK `guard()` does this for tool outputs; add other context with `addSource`). Unregistered content can't be traced, and its destinations then count as model-generated (≥ REVIEW).
- [ ] **Fail closed** stays on for sinks (default). `allow-reads` only for read-only tools, if at all.
- [ ] **Tool services verify tokens** where you control them. Without this, the SDK is cooperative.
- [ ] **Separate keys per role**: `check` for agent runtimes (bind to an agent where possible), `verify` for tool services, `admin` only for setup/CI. Revoke on leak (UI or `admin revoke-key`).
- [ ] **Keep `AUTH_SECRET` stable and secret**: token keys derive from it.
- [ ] **REVIEW reaches a human** who sees the exact arguments: the Approval Inbox shows app, agent, destination provenance and signals.

## 5. Threat model of an integration

| Threat | Mitigation | Residual risk |
|---|---|---|
| Prompt injection makes an agent send data to an attacker | destination provenance + default deny; injected signals escalate to REVIEW | paraphrased/encoded exfiltration to an **allowed** destination |
| Agent runtime skips the guard | tool-side verifier (no token ⇒ refuse); MCP gateway in the path | tools you don't control and don't route through the gateway |
| Arguments changed after the decision | token binds the canonical args hash; approvals bind args + policy version | none known for verified tools |
| Token replay | single use (server `consumed_at` or verifier cache), 60 s expiry | offline verifier across replicas (use online mode) |
| Stolen API key | hashed at rest, scopes, agent binding, revocation, per-key rate limit | a stolen `check` key can open sessions and ask for decisions (not execute) |
| Cross-tenant access | every query scoped by app; other apps' ids → 404 | demo UI identities are not real auth: keep the UI private |
| Callwrit down | SDKs and gateway fail closed | availability: guarded sinks stop |
| Sub-agent laundering | sub-agents act in the same session and see the same untrusted provenance | content that leaves Callwrit's view (e.g. a separate pipeline) and comes back unregistered |
| Privacy | fingerprints instead of content by default; content args hashed in audit | tool arguments themselves are sent (they are what the policy decides on) |

**Not production-ready:** no IdP/OIDC for the approval UI, no HA, HMAC tokens (Ed25519 is on the roadmap), self-authored evaluation datasets. See [threat-model.md](threat-model.md).
