# Contributing to AgentGuard

Thanks for your interest! Issues and pull requests are welcome.

## Development setup

```bash
git clone https://github.com/hoangtularva/agentguard.git
cd agentguard
npm install
cp .env.example .env        # Windows: copy .env.example .env
npm run dev                 # http://localhost:3000
```

No database server is needed: the app uses embedded PGlite. `npm run test:pg` starts a real PostgreSQL 16 automatically.

## Before opening a pull request

```bash
npm run lint && npm run typecheck
npm test                 # unit + integration (Vitest)
npm run test:pg          # real PostgreSQL suite
npm run test:e2e         # Playwright (run `npx playwright install chromium` once)
npm run bench            # deterministic security benchmark must stay 100% / deterministic
```

## Ground rules

- **Security semantics need tests.** Any change to the policy engine, PEP, approvals or provenance needs a test that fails without the change.
- **Never relax a rule to make a benchmark pass.** If a benchmark exposes a false positive, fix the cause (bug, error message, measurement) and explain it in the PR.
- **Don't edit the held-out benchmark set** (`src/server/bench/llm-v2-scenarios.ts`, `V2_HOLDOUT`) to improve scores. Add new scenarios to a dev set instead.
- **Executors stay behind the PEP:** the lint rule and `tests/unit/boundaries.test.ts` must pass.
- Keep demo data synthetic (`*.example` domains). No real secrets or personal data.

## Commit style

Conventional-ish prefixes (`feat:`, `fix:`, `security:`, `bench:`, `docs:`), with what changed and why in the body.

## Licensing of contributions

AgentGuard is dual-licensed by directory (see [LICENSING.md](LICENSING.md)): contributions to `packages/core`, `packages/sdk-ts` and `sdk/python` are made under the MIT License; all other contributions under the AGPL-3.0.

The maintainer may also offer AgentGuard under commercial terms. So that this stays possible, by submitting a contribution you confirm that you wrote it (or have the right to submit it) and you grant the maintainer a perpetual, worldwide, irrevocable, royalty-free license to use, modify and relicense your contribution, including under other license terms. You keep your copyright. If you do not agree, please open an issue instead of a pull request.
