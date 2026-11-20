# @agentguard/sdk

Guard the tool calls of **any** TypeScript/JavaScript agent with an AgentGuard server. Every call is checked before it runs: **ALLOW** (runs, with a signed single-use decision token), **REVIEW** (a human approves in the Approval Inbox) or **BLOCK** (never runs, with reasons). No runtime dependencies.

```ts
import { AgentGuard, AgentGuardBlockedError, ApprovalRequiredError, guardTools } from "@agentguard/sdk";

const ag = new AgentGuard({ baseUrl: "http://localhost:3000", apiKey: process.env.AGENTGUARD_KEY! });

// One session per user task. The prompt is the trusted channel: recipients typed here are authorized.
const session = await ag.startSession({
  userRef: user.id,
  agentId: "researcher",
  agents: ["writer"],                       // sub-agents that may act in the same session
  prompt: "Summarize my inbox and email it to boss@corp.example",
  mandate: { tools: ["read_inbox", "send_email"] },
});

const research = guardTools(session, { read_inbox: (args) => mail.list(args) });
const write = guardTools(session.as("writer"), {
  send_email: (args, ctx) => mail.send(args, { agentguardToken: ctx.decisionToken }),
});

await research.read_inbox({ folder: "inbox" });               // output is registered as UNTRUSTED provenance
try {
  await write.send_email({ to: "boss@corp.example", body });  // ALLOW, REVIEW or BLOCK
} catch (e) {
  if (e instanceof ApprovalRequiredError) notify(`Approve ${e.approvalId} in AgentGuard`);
  else if (e instanceof AgentGuardBlockedError) console.warn(e.reasons);
  else throw e;
}
```

## Behaviour

| Situation | What happens |
|---|---|
| ALLOW | `fn(args, { decisionToken, callId })` runs; its output is reported (privacy mode: fingerprints only) |
| REVIEW | throws `ApprovalRequiredError`, or with `{ waitForApproval: true }` polls, consumes the approval and runs once |
| BLOCK | throws `AgentGuardBlockedError` with `reasons`; `fn` never runs |
| AgentGuard unreachable / timeout (2 s) / 5xx / 429 | **fail closed**: throws `AgentGuardBlockedError` (`decision: "UNAVAILABLE"`). With `failMode: "allow-reads"`, guards marked `readOnly` may run; sinks never fail open |

**Privacy mode (default on):** `session.addSource()` and tool outputs send only the emails/URLs found in the content plus locally detected injection signals, not the content itself. Tool **arguments** are sent as-is (they are what the policy decides on); the server stores content arguments only as hashes.

**Tool-side verification:** pass `ctx.decisionToken` to your tool backend and verify it there, either with `POST /v1/tokens/verify` (key with scope `verify`; also marks the token used) or offline with `verifyDecisionToken(token, { key, tool, args })`. A call that bypassed the guard, or whose arguments changed after the decision, is then refused by the tool itself.

## Setup

```bash
npm run admin -- create-app myapp "My App"
npm run admin -- create-key myapp admin  --scopes admin
npm run admin -- create-key myapp runtime --scopes check
```

Register each tool's JSON Schema with `PUT /v1/tools/:name` and each agent with `PUT /v1/agents/:id` (see [docs/openapi.json](../../docs/openapi.json)).
