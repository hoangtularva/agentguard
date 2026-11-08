# Blockers and unverified items

Updated 2026-11-08 (Phase 2, after Docker install).

| ID | Item | Status | Evidence |
|---|---|---|---|
| B-01 | Docker Compose stack | **RESOLVED** | With the user's go-ahead: `wsl --update` (elevated, user approved UAC) → Docker Desktop 4.98.0 installer from desktop.docker.com, Authenticode **Valid** (signed by Docker Inc, DigiCert CA) → `install --quiet --backend=wsl-2` (elevated, without `--accept-license`, so Docker's terms are presented to the user by Docker Desktop). Engine 29.9.2, Compose v5.6.1. `docker compose config` valid; `up --build -d` → db + app **healthy**; 7 routes HTTP 200; migrations applied (1 migration, 13 tables) on PostgreSQL 16.15 in the container; data persisted across an app restart; no errors in the logs; **Playwright 13/13 against the stack** (`E2E_BASE_URL=http://localhost:3000`); container reaches host Ollama via `host.docker.internal` |
| B-02 | Multi-connection locking on real PostgreSQL | **RESOLVED** | `npm run test:pg` 11/11 (real PG16, 10-connection pool) |
| B-03 | Real LLM | **RESOLVED (local)** | Ollama 0.40.15 + qwen2.5:3b; real-LLM benchmark on the held-out set (2 runs). Anthropic path **NOT VERIFIED** (no API key; optional) |
| B-04 | WSL kernel auto-update disabled in Windows Update settings | Informational | Optional: enable "Receive updates for other Microsoft products" |

**Known gotcha:** a terminal opened *before* the Docker install does not have `C:\Program Files\Docker\Docker\resources\bin` on PATH, so `docker compose up` fails with `docker-credential-desktop: executable file not found`. Open a new terminal (or add that folder to PATH).

Nothing was pushed, deployed or sent externally. No paid service was used.
