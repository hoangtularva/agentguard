# Interview guide — Callwrit

A 5-minute walkthrough, followed by the questions an AI/LLM-engineering interviewer is likely to ask, with honest answers grounded in this repo.

## 5-minute demo script

1. **Problem (30 s).** "Agents act with the user's authority but read attacker-controlled content. Prompting the model to 'ignore instructions in documents' is not a control. The attacker controls the model's input."
2. **Playground, 'Injection in an email' (90 s).** Show the trace: the injected restricted read is **BLOCKED** (out of scope), the exfiltration email is **BLOCKED** (the destination came from untrusted content and no rule permits it), and the legit email is paused for **REVIEW**. Expand a step to show reasons, policy version and provenance. Approve, and it executes exactly once.
3. **Same task with the local LLM (60 s).** Switch the agent to Ollama. It's a real model, and the same PEP sits in front of it.
4. **Attack Lab (60 s).** Run the 37-scenario suite. Show baseline vs guarded ASR, false positives, and the **rubber-stamp** ASR (the honest number). Scroll to the real-LLM panel: outcomes split into *attack_not_attempted* and *attack_blocked*.
5. **Policy Studio (30 s).** Simulate a draft rule. Saving a version invalidates pending approvals bound to the old one.

## Likely questions and answers

**Why not let the LLM judge whether an action is safe?**
The attacker controls the LLM's input, so an LLM judge is just another surface to inject into. Decisions here are pure functions of server-computed facts: identity, mandate, resource sensitivity, destination provenance, policy version. That makes them deterministic, testable and fast (~3 µs). Signals from heuristics can only *escalate*.

**What does "provenance" mean here, and what are its limits?**
For outbound tools, the PEP checks which context sources contain the exact (normalized) destination: the user prompt (trusted), retrieved content (untrusted), or none (model-generated). If the user didn't provide it, the call can't be auto-allowed. Limit: it is value-level matching, not data-flow tracking. Obfuscated addresses (`finance [at] contoso [dot] example`) become "model-generated", which is still not trusted, so default deny applies. But if an attacker steers the model to an *allowlisted* destination with different content, provenance won't catch it. CaMeL-style interpreters track this properly, at the cost of rewriting the agent.

**How do you prevent approval replay and race conditions?**
Three layers in PostgreSQL. (1) `SELECT … FOR UPDATE` on the approval row. (2) A conditional claim `UPDATE … WHERE status='approved'`. (3) Unique constraints on `executions.tool_call_id` and `executions.idempotency_key`. The claim and the execution share **one transaction**. An earlier version split them, and a real-Postgres test showed that a failure after the claim left the approval "used" without executing. The binding hash covers call, session, user, agent, tool, args and policy version.

**How did you test concurrency for real?**
`npm run test:pg` starts a real PostgreSQL 16 server (official binaries, no Docker). The tests: ten parallel executes across separate backends produce one side effect; same-key retries; two different approvals racing on one idempotency key (the loser rolls back fully); a policy activation racing an execution; killed connections; an unreachable DB.

**Your benchmark says 0% attack success. Is it secure?**
No. 0% means the enforcement mechanisms worked on the scenarios I wrote, with a reviewer who rejects attacks. I also report: the rubber-stamp ASR (reviewer approves everything), the false positive rate, review friction, a **held-out** set written after the policy was frozen, and a real-LLM track with its model digest and sampling. Known gaps are listed in the threat model.

**Why a simulated agent at all?**
To measure the *guard*, I need an agent that reliably attempts the attack. Real models sometimes ignore injections, which makes "no attack" ambiguous. The deterministic agent gives zero-variance regression tests. The real-LLM track answers a different question: how often does a real model attempt the attack, and what does the guard do when it does?

**What breaks if a policy author makes a mistake?**
Default deny limits the blast radius: forgetting a rule blocks rather than allows. A test found the opposite failure in my own semantics. A "review if suspicious" rule was turning default-deny into REVIEW, so I introduced `escalateOnly` rules that can never grant permission. Policies are Zod-validated, immutable and versioned, and they fail closed if they can't be loaded.

**Production gaps?**
Real auth (OIDC) and agent workload identity; separation of duties (requester ≠ approver); executors in a separate service holding the credentials and accepting only PEP-signed, single-use execution tokens (today they share a process); a hash-chained audit log; rate limiting beyond the demo's single-flight guard; CSP headers.

**How would you scale it?**
The PDP is a pure function, so it scales horizontally or can be embedded in each agent host. The PEP needs the DB for approvals and audit. Postgres handles the locking. The policy could move to OPA or Cedar behind the same interface. An MCP proxy mode would guard existing agents without code changes.

**What did you learn?**
Security bugs hid in *semantics*, not syntax: the escalation rule, a transaction boundary, a UX mode that hid evidence. Each was found by a test written to check a property rather than an implementation.

## Architecture trade-offs (one-liners)

| Choice | Benefit | Cost |
|---|---|---|
| Deterministic rules | testable, explainable, µs latency | someone has to write rules |
| Value-level provenance | cheap, framework-agnostic | misses paraphrase / encoding |
| Session-level sensitivity taint | never under-classifies | can over-block after a sensitive read |
| REVIEW instead of BLOCK for ambiguous cases | keeps legit tasks possible | only as safe as the reviewer |
| Single process (demo) | simple | the PEP is not a hard process boundary |
| PGlite in dev, Postgres in prod | zero-setup demo, same SQL | single-connection in dev; real concurrency tested separately |
| Local LLM via Ollama | free, private, reproducible (temp 0, seed) | slow on CPU, weaker tool-use fidelity |

## Phase 3 questions (evaluation rigor & red team)

**How do you know you didn't overfit the benchmark?**
Two splits. DEV (32 scenarios) is used to find *bugs*. Each change made after a DEV run is recorded with its reason: two were product/measurement bugs (unhelpful argument errors; an oracle counting hallucinated recipients as legitimate), and no policy rule was changed. Then the code was frozen (commit hash in the benchmark log) and the 32-scenario HOLDOUT was run once, with three seeds and Wilson 95% confidence intervals.

**What does "0% attack success" mean with a CI of 0–16%?**
On those runs no forbidden call executed under the guard, but the sample is small: a true rate as high as ~16% isn't ruled out. And repetitions of one scenario are correlated, so the real interval is wider. It's evidence that the mechanisms work, not a guarantee.

**Why distinguish "attack not triggered", "blocked" and "reviewed"?**
If the model ignores an injection, the guard did nothing, so crediting the guard would inflate results. "Reviewed" is weaker than "blocked": it's only safe if the human rejects.

**What did your red team find?**
Identity and authorization gaps in the *application around* the guard: an implicit default user, a demo identity switch that let anyone become an approver, and IDOR on read pages exposing another user's pending action arguments. Also smaller issues: an unbounded body, no CSP, members able to start CPU-heavy benchmarks. All are fixed with regression tests, except real authentication, which is documented as out of scope.

**What surprised you about real models?**
Hallucinated destinations. Unguarded, the 3B model invented recipients and *sent internal data to them*. That isn't an attack, but provenance-based default deny stops it all the same.

## Phase 4 questions (integration with other codebases)

**"How would I use this with my own multi-agent app?"** Register the app and its tools (JSON Schema + source/sink + destination argument), wrap each tool function with the SDK's `guard()` (or put the MCP gateway in front of an MCP server). The agent asks before each call; Callwrit answers ALLOW (+ token), REVIEW or BLOCK. Sub-agents act in the same session, so content one agent read stays untrusted for the next.

**"What stops an agent from just not calling Callwrit?"** Nothing, if the tool doesn't check. That's why there are decision tokens: the tool service verifies a 60-second, single-use token bound to the exact tool and arguments, and refuses without one. Through the MCP gateway the check is in the path anyway.

**"Why doesn't Callwrit execute the tools for external apps?"** It would need the app's credentials and become the most valuable target in the system. Decision-only keeps secrets and side effects in the host; Callwrit only decides, records and proves.

**"What does Callwrit learn about my users' data?"** In privacy mode (default) only the emails/URLs found in content plus local injection signals, never the text. Tool arguments are sent, because they are what the policy decides on; content arguments are hashed in the audit log.

**"What if Callwrit is down?"** The SDKs and the gateway fail closed: no decision, no side effect. Read-only tools can opt in to fail open.

**"Biggest remaining weakness?"** The app backend that holds a `check` key is trusted to report the user's real request (T42). A compromised backend can open a session claiming the user asked to email the attacker. Mitigations are operational: keep keys out of the model's reach, bind them to agents, open sessions server-side.
