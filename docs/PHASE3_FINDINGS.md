# Phase 3 security findings (red team, 2026-11-08)

**Scope:** the local Callwrit deployment only (Docker stack on `127.0.0.1:3000` + dev server), synthetic data. No external systems were scanned or attacked.
**Method:** black-box HTTP probing with `curl` against the production build in Docker, code review, then a regression test for every confirmed finding.

Severity uses the impact *if the demo were reachable by more than one person* (e.g. a shared lab or a mis-bound port). On a single-user laptop bound to localhost, most identity findings are lower risk. They are still fixed, because a portfolio security project should not ship them.

| ID | Finding | Severity | Status | Regression test |
|---|---|---|---|---|
| F1 | Requests without a session cookie were silently treated as **Alice** (implicit default identity) | **High** | Fixed | `security.spec.ts` "API mutations without a session are rejected (401)", "pages without a session show the demo sign-in" |
| F2 | Forged identity cookie (bad HMAC) | — | **Pass** (already rejected) | `security.spec.ts` F2, `identity.test.ts` |
| F3 | `POST /api/identity` let anyone become **approver Bob** and then write policy (verified: `200` on policy write) | **High** | Mitigated: demo sign-in gated behind `CALLWRIT_DEMO_AUTH` (off by default in production; compose enables it explicitly and binds to 127.0.0.1); sign-out added. Real auth (OIDC) remains out of scope and is documented as such | `identity.test.ts` "demo sign-in is off in production unless explicitly enabled" |
| F4 | **IDOR / over-broad reads**: a member (Mallory) could read Alice's pending action with its exact arguments (`/approvals`), her session audit record (`/sessions/:id`) and events | **Medium** | Fixed: all read models scoped to the viewer; members see only their own data; approvers/admins see all; foreign session ids return 404 (no existence oracle) | `security.spec.ts` "another member cannot read Alice's pending action, session or events" |
| F5 | Unbounded request bodies: a 5 MB JSON was fully read and parsed before validation (6.2 s) | Low | Fixed: 64 KB cap, enforced by both Content-Length and a streamed byte count → 413 | `security.spec.ts` "oversized JSON bodies are refused with 413" |
| F6 | No Content-Security-Policy | Low | Fixed: CSP with `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `form-action 'self'`. `script-src` still needs `'unsafe-inline'` (Next.js bootstrap without nonces), so this is a partial XSS mitigation | `security.spec.ts` "a Content-Security-Policy is sent" |
| F7 | Any member could start the CPU-heavy benchmark (a 1-scenario run took > 180 s under load) | Low | Fixed: approver/admin only (+ existing single-flight guard) | `security.spec.ts` "members cannot start the CPU-heavy benchmark" |
| F8 | `GET /api/llm/status` reveals the internal Ollama URL | Info | Accepted (needed by the UI; no secret) | — |
| F9 | Requester may approve their own action (no separation of duties) | Info (by design) | Documented as a production gap | — |
| F10 | Hydration mismatch in the approval countdown (`Date.now()` during render) | Low (UX) | Fixed: renders a stable timestamp until mounted | e2e (no hydration error) |

## Checks that passed (no change needed)

| Area | Probe | Result |
|---|---|---|
| CSRF | POST with `Origin: https://evil.example`; POST with `Sec-Fetch-Site: cross-site` | 403 / 403 |
| Cross-user approval | Mallory decides / executes Alice's approval over HTTP | `NOT_AUTHORIZED` / `NOT_AUTHORIZED` |
| Privilege escalation | member → `POST /api/policies` | 403 |
| XSS | `<img src=x onerror=alert(1)>` in the prompt, rendered on the session page | HTML-escaped (`&lt;img…`); no `dangerouslySetInnerHTML` in the codebase |
| SQL injection | `?type=tool_call' OR 1=1--&session=ses_x';` on `/events` | filtered by whitelists / regex; all SQL goes through Drizzle parameters |
| SSRF | user-controlled URLs (`export_data.destination`) | never fetched (mock tool); the Ollama host comes from env only |
| Secret leakage | `AUTH_SECRET` value searched in responses of `/`, `/policies`, `/events`, `/api/llm/status` | not found |
| Error handling | malformed JSON, unknown approval id | structured 400 / 409, no stack traces |
| Approval security | replay, concurrency, modified/tampered args, expiry, wrong user, policy change | covered by 12 integration + 11 real-PostgreSQL + e2e tests (all pass) |
| PEP bypass | executor imports outside the PEP | lint rule + architecture test pass |
| Dependencies | `npm audit --omit=dev` | 0 vulnerabilities |

## Side effect of testing (disclosed)
The F3 reproduction created one **inactive** policy version ("redteam test", `activate:false`) in the Docker database, and several sessions with synthetic data. The active policy was never changed. These rows are left in place as audit evidence.

## Not covered / residual
- Real authentication (OIDC, MFA) and session revocation; demo identities are fundamentally not authentication.
- `'unsafe-inline'` in `script-src`; nonce-based CSP would need middleware.
- Rate limiting per user (only the single-flight guard exists).
- Audit log is append-only by convention, not tamper-evident.
