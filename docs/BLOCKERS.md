# Blockers and unverified items

| ID | Item | Status | Impact | Workaround used | To unblock |
|---|---|---|---|---|---|
| B-01 | Docker is not installed on the build machine | **NOT VERIFIED**: `docker compose up` was never run | Compose and Dockerfile are untested as a whole | (a) `next build` standalone output started and served `/` and `/attack-lab` with HTTP 200; (b) the node-postgres `DATABASE_URL` path (migrations, seed, enforcement, approval) passed over the PostgreSQL wire protocol using pglite-socket (`tests/integration/pg-wire.test.ts`) | On a machine with Docker: `cp .env.example .env`, set `AUTH_SECRET`, `docker compose up --build`, open http://localhost:3000, run the Attack Lab |
| B-02 | No PostgreSQL server available | **PARTIALLY VERIFIED** | Multi-connection row-lock behaviour (`FOR UPDATE` across separate connections) was not exercised on a real server; pglite-socket serves one connection at a time | Concurrency tested on PGlite (5 parallel executes → 1 side effect) and by unique constraints | Run `npm test` with `DATABASE_URL` pointing at Postgres 16 (adapt `tests/helpers.ts` to use the URL), or run the e2e suite against the compose stack |
| B-03 | No `ANTHROPIC_API_KEY` in the environment | **NOT VERIFIED**: the Claude planner and `npm run bench:llm` were never executed | No LLM-based adversarial numbers exist; none are claimed | The code typechecks against `@anthropic-ai/sdk` 1.6.0; the route returns 400 `llm_not_configured` without credentials | Set `ANTHROPIC_API_KEY`, run `npm run bench:llm -- --runs 3`, and add the results to benchmark.md with model, effort and date |

No task was skipped for safety or permission reasons. Nothing was pushed, deployed, or sent externally.
