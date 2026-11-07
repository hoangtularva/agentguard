# Phase 2 plan — Windows setup, Docker, real PostgreSQL, local LLM, real-LLM evaluation

**Date:** 2026-11-07 · **Repository:** `D:\AI Master\agentguard` (moved from a temporary workspace; git history restored, 7 commits, clean tree).

## Environment audit (Phase 0)

| Item | Finding |
|---|---|
| OS / shell | Windows 10 Pro 22H2 (build 19045), x64. Claude Code runs Git Bash + Windows PowerShell 5.1 (not WSL) |
| CPU | Intel Core i5-7200U, 2 cores / 4 threads, AVX2 |
| RAM | 11.9 GB total, ~3.5 GB free at audit time |
| GPU | Intel HD Graphics 620 (no CUDA/ROCm) → CPU-only inference |
| Disk | C: 130 GB free · D: 123 GB free |
| Virtualization | Hypervisor present (Hyper-V/VBS running) |
| WSL | Installed, default version 2, **kernel file missing**, no distributions |
| Docker | Not installed |
| PostgreSQL | Not installed |
| Ollama | Not installed |
| Node / npm / Git | Node 22.14, npm 11.6, Git 2.41 |

## Status carried over from Phase 1
Done and verified: policy engine, PEP, approvals, audit, simulated agent, 37-scenario deterministic benchmark, UI, 61 Vitest + 13 Playwright tests.
Not verified: Docker Compose (B-01), multi-connection locking on real PostgreSQL (B-02), LLM planner (B-03).

## Plan and approach per phase

| Phase | Approach | Needs the user? |
|---|---|---|
| 1 Docker | Docker Desktop's installer and `wsl --update` both need **Administrator**, and possibly a restart. Write exact steps in BLOCKERS; do not attempt elevation. | **Yes**: admin install + restart |
| 2 Real PostgreSQL | Use the official PostgreSQL 16 binaries via the `embedded-postgres` npm package (no admin, runs as the current user on a local port, data in `.data/`). Add a dedicated integration suite: migrations, transactions, concurrent approvals across real connections, idempotency, replay, policy change, session consistency, connection failure and rollback. | No |
| 3 Ollama | Official portable zip from GitHub releases (no installer, no admin) in `D:\AI Master\_tools\ollama`. CPU-only → small tool-calling model (Qwen2.5 1.5B/3B class, ~1–2 GB). Provider adapter interface: simulated / Ollama / Anthropic. | No |
| 4 Real-LLM eval | Separate benchmark track (`bench:llm`) with its own report. **Independent test set** written separately from the development scenarios. Unguarded vs guarded. Record the model digest, sampling, runs and per-scenario failure causes. Scope sized to CPU speed. | No |
| 5 UI | Provider selection + status, error states, Attack Lab export (JSON/CSV) and failure analysis, LLM results view. | No |
| 6 Audit | Code and security review, `npm audit`, fix Critical/High first. | No |
| 7 Gates | lint, typecheck, build, unit, integration, real-PG suite, e2e, benchmarks. | No |
| 8 Docs | Windows / Docker / Ollama / demo / reproduction guides, interview Q&A, trade-offs. | No |

## Acceptance criteria tracking
See the "Phase 2" section in [FINAL_REPORT.md](FINAL_REPORT.md) (updated at the end).
