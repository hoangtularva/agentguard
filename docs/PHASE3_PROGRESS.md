# Phase 3 progress (checkpoint)

**Resume here:** see the last row. Ollama runs from `D:\AI Master\_tools\ollama` (`OLLAMA_MODELS=D:\AI Master\_tools\ollama-models`). Docker stack: `docker compose up -d` (new terminal so Docker is on PATH).

| # | Task | Result | Commit |
|---|---|---|---|
| 1 | Re-verify Phase 2 claims | git clean; Docker db+app healthy; Ollama 0.40.15 + qwen2.5:3b; multi-tool session (3 calls in one turn, all via PEP); lint/tsc OK; vitest 66/66; test:pg 11/11 | — |
| 2 | llm-v2 dataset (32 DEV + 32 HOLDOUT, 13 categories), `attack_reviewed` outcome, per-run seeds, Wilson CIs, approval rate | done | 19b1d55 |
| 3 | DEV run 1 (seed 42) | ASR 50% → 0%; 12 unauthorized calls (11 BLOCK, 1 REVIEW, 0 ALLOW); "FP" 15/40 → analysed: 11 INVALID_ARGUMENTS with unhelpful errors, 3 hallucinated destinations mislabelled as legit | (doc in docs/results) |
| 4 | Red team (P1) + fixes (P2): F1, F3, F4, F5, F6, F7, F10 | e2e 20/20 incl. 7 new security tests; vitest 69/69 | 3d176bb |
| 5 | DEV-driven fixes: actionable argument errors; FP measured on user-requested calls only | unit 47/47 | 8f6eb0f |
| 6 | UI: approval summary + double-submit ref guard, step headline, sign-out; PG perf test; screenshot script | tsc/lint OK | (next) |
| 7 | DEV run 2 (after fixes) | FP 37.5%→9.7%, guarded completion 75%→100%, guarded ASR 0% | 078b567 (frozen) |
| 8 | HOLDOUT (frozen code, seeds 42/43/44) | ASR 66.7%→0.0% (CI 0–6%), completion 97.2% both, FP 2/100, unrequested destinations 13→0 executed | 4ff4430 |
| 9 | Preview screenshots (5) | docs/screenshots/0[1-5]-*.png | (next) |
| 10 | **Phase 4 plan** (multi-method integration for any codebase) | docs/PHASE4_INTEGRATION_PLAN.md | (next) |
| 11 | Perf test (real PG16, 50k events) | overview p95 ≈ 40 ms, events ≈ 5 ms → no indexes needed | (this) |
| 12 | Docker rebuild + e2e on stack | 20/20; e2e keys made unique (persistent DB) | (this) |
| 13 | Open-source release: README, LICENSE (MIT), SECURITY, CONTRIBUTING, templates, CI, screenshots, case study results, Phase 3 final report | done — **PHASE 3 COMPLETE** | (this) |
