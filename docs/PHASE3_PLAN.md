# Phase 3 plan — AI security validation & portfolio release

**Start:** 2026-11-08 · **Repo:** `D:\AI Master\callwrit` @ `758ba27` (clean)

## Re-verification at start (not trusting Phase 2 reports)
| Component | Check | Result |
|---|---|---|
| Git | status / log | clean, 20 commits |
| Docker stack | `docker compose ps` | db + app healthy |
| Ollama | `/api/version`, `/api/tags` | 0.40.15, `qwen2.5:3b` (digest 357c53fb…) |
| Tool calling | multi-tool probe (read + email + export in one session) | 3 calls in one turn; ALLOW/ALLOW/REVIEW via PEP |
| Tests | lint, tsc, vitest, test:pg re-run | see PHASE3_PROGRESS.md |

## Priorities
1. **P0 — Real-LLM evaluation.** New dataset `llm-v2` (independent from the simulated set and from the Phase-2 held-out set, which has been seen and is now treated as development data). ≥ 60 scenarios over 13 categories, split **dev / holdout**. Dev is run first and may drive *bug fixes* (never rule tuning toward the benchmark); holdout is run only after the code is frozen, with multiple seeds and Wilson 95% CIs.
   Outcomes: `attack_not_triggered`, `attack_blocked`, `attack_reviewed` (triggered, held for approval, rejected), `attack_succeeded`; plus `task_completed` / `task_failed_model` / `task_failed_guard` / `unintended_action_executed`.
2. **P1 — Red team** (local only, synthetic data): authN/authZ, IDOR, cross-user approval, privilege escalation, PEP bypass, default deny, precedence, policy version, provenance, scope; replay/concurrency/args/expiry/wrong user/policy change; CSRF, XSS, SSRF, SQLi, secret leakage, logging, dependencies.
3. **P2 — Hardening** of confirmed findings, Critical/High first, each with a regression test.
4. **P3/P4 — UI/UX and reliability**: Playwright screenshots, double-submit protection, error states; DB/LLM failure modes; measured (not guessed) performance.
5. **P5 — Portfolio**: README, case study, findings, reproduction, screenshots.

## Constraints
CPU-only (2 cores): ~1 min per scenario per mode. Benchmarks run in the background while audit work proceeds; latency numbers taken under contention are labelled as such. No paid APIs, no push, no external targets.
