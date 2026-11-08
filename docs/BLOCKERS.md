# Blockers and unverified items

Updated 2026-11-08 (Phase 2).

| ID | Item | Status | What was done | What the user must do |
|---|---|---|---|---|
| B-01 | Docker Compose stack | **BLOCKED — needs Administrator** | Audit: Windows 10 Pro 22H2 x64, hypervisor present, WSL installed (default v2) but **WSL 2 kernel missing**, no distro, Docker not installed. Both `wsl --update` and the Docker Desktop installer need elevation and may need a reboot, so neither was attempted (the rules say ask first). Verified instead: standalone production build serves HTTP 200; node-postgres path over the wire protocol; full suite on a **real PostgreSQL 16** server (B-02). `docker-compose.yml` is unchanged and still **NOT VERIFIED**. | Follow [setup-windows.md § C](setup-windows.md): admin `wsl --update` → install Docker Desktop (WSL 2 backend) → reboot if asked → `docker compose up --build -d` → `$env:E2E_BASE_URL="http://localhost:3000"; npm run test:e2e` |
| B-02 | Multi-connection locking on real PostgreSQL | **RESOLVED** | `npm run test:pg`: 11 tests on a real PostgreSQL 16.x server (official binaries via `embedded-postgres`, no admin) with a 10-connection pool. Found and fixed a non-atomic claim/execute (see FINAL_REPORT) | — |
| B-03 | Real LLM | **RESOLVED (local)** | Ollama 0.40.15 (portable zip, SHA-256 verified) + `qwen2.5:3b` on CPU. Real-LLM benchmark run on the held-out set. The Anthropic path is still **NOT VERIFIED** (no API key; not needed) | Optional: set `ANTHROPIC_API_KEY`, then `npm run bench:llm -- --provider anthropic` |
| B-04 | WSL kernel auto-update disabled by Windows Update settings | Informational | Reported by `wsl --status` | Optional: enable "Receive updates for other Microsoft products" |

Nothing was pushed, deployed or sent externally. No paid service was used.
