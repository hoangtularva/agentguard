# Setup guide — Windows (also works on macOS/Linux)

Three ways to run AgentGuard, from least to most setup:

| Mode | Needs | Database | Agent |
|---|---|---|---|
| **A. Quick demo** | Node 22+ | PGlite (embedded, no server) | Simulated (deterministic) |
| **B. Local LLM** | + Ollama | PGlite | Ollama model (free, local) |
| **C. Docker Compose** | + Docker Desktop | PostgreSQL 16 container | Simulated / Ollama on the host |

---

## A. Quick demo (no admin rights needed)

```powershell
cd agentguard
npm install
copy .env.example .env
npm run dev
```

Open http://localhost:3000 → **Agent Playground** → preset **"Injection in an email"** → **Run agent**.

## B. Local LLM with Ollama (no admin rights needed)

Tested on this repo's build machine: Windows 10 Pro, i5-7200U (2 cores), 12 GB RAM, **no GPU**, Ollama 0.40.15, `qwen2.5:3b`.

1. Install Ollama, either way:
   - **Installer:** https://ollama.com/download → `OllamaSetup.exe` (per-user install), or
   - **Portable zip (what this repo was tested with):** download `ollama-windows-amd64.zip` from https://github.com/ollama/ollama/releases, check its SHA-256 against the release page, and extract it to a folder such as `D:\tools\ollama`.
2. Start the server (skip this if the installer's tray app is running):
   ```powershell
   $env:OLLAMA_MODELS = "D:\tools\ollama-models"   # optional: keep models off C:
   D:\tools\ollama\ollama.exe serve
   ```
3. Pull a tool-calling model sized for your machine (in another terminal):
   ```powershell
   D:\tools\ollama\ollama.exe pull qwen2.5:3b
   ```
   | RAM / GPU | Suggested model | Disk |
   |---|---|---|
   | 8 GB, CPU only | `qwen2.5:1.5b` | ~1 GB |
   | 12–16 GB, CPU only | `qwen2.5:3b` (default) | ~1.9 GB |
   | 16 GB+ or a GPU | `qwen2.5:7b`, `llama3.1:8b` | ~4.7 GB |
4. Optional `.env` settings: `OLLAMA_HOST=http://127.0.0.1:11434`, `AGENTGUARD_OLLAMA_MODEL=qwen2.5:3b`.
5. In the Playground, choose **Ollama (local)** and press **Check** if it shows "not running". On CPU, expect 10–30 s per model turn.

If Ollama is down, the Playground says so and Simulation mode keeps working.

## C. Docker Compose (needs Administrator once)

Docker Desktop on Windows uses the WSL 2 backend. Official docs: https://docs.docker.com/desktop/setup/install/windows-install/ and https://docs.docker.com/desktop/features/wsl/

1. **Admin PowerShell:** `wsl --update` (installs the WSL 2 kernel). Reboot if asked.
2. Install Docker Desktop from the official page (needs admin; accept its license). Keep "Use WSL 2 based engine" ticked. Reboot if asked.
3. Start Docker Desktop and wait for "Engine running". Then, in a normal terminal:
   ```powershell
   docker version
   docker compose version
   cd agentguard
   copy .env.example .env      # set AUTH_SECRET to a random 32+ char string
   docker compose config       # validates the file
   docker compose up --build -d
   docker compose ps           # both services healthy
   docker compose logs app --tail 50
   ```
4. Open http://localhost:3000. Then run the e2e suite against the stack:
   ```powershell
   $env:E2E_BASE_URL = "http://localhost:3000"; npm run test:e2e
   ```
5. To use Ollama on the host from the container, set `OLLAMA_HOST=http://host.docker.internal:11434` for the `app` service.

`docker compose down` stops the stack but keeps the `pgdata` volume. Only `docker compose down -v` deletes the data; don't use it unless you mean to.

## Running the tests

| Command | What it covers | Needs |
|---|---|---|
| `npm run lint` / `npm run typecheck` | static checks | — |
| `npm test` | unit + integration (PGlite, wire protocol, LLM provider mocks, benchmark gate) | — |
| `npm run test:pg` | 11 tests on a **real PostgreSQL 16** server (official binaries via `embedded-postgres`, started on port 54329, deleted afterwards) | — |
| `npm run test:e2e` | Playwright desktop + mobile | `npx playwright install chromium` once |
| `npm run bench` | deterministic benchmark → `docs/benchmark-latest.md` | — |
| `npm run bench:llm` | real-LLM benchmark → `docs/benchmark-llm-latest.md` | Ollama + model |

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ENOENT … .data\pglite` | Delete `.data\pglite` only if you don't need the demo data, or set `PGLITE_DIR` to a writable folder |
| Playground: "Ollama is not reachable" | Start `ollama serve` and press **Check** |
| "model is not pulled" | `ollama pull <model>` for the model named in the message |
| `429 busy` | One LLM run or benchmark is already in progress (single-flight guard). Wait for it to finish |
| `wsl --status`: "kernel file not found" | Run `wsl --update` in an admin terminal |
