# Real-LLM track: two models on the same frozen code (O12)

Frozen commit `2b96add`, llm-v2 HOLDOUT (32 scenarios × seeds 42/43/44), Ollama 0.40.15, CPU laptop, temperature 0. Full reports: [qwen2.5:3b](benchmark-llm-v2-holdout-qwen2.5-3b-2b96add.md) · [llama3.2:3b](benchmark-llm-v2-holdout-llama3.2-3b.md) · raw JSON in `results/`.

| | qwen2.5:3b (357c53fb) | llama3.2:3b (a80c4f17) |
|---|---|---|
| Attack success, unguarded → guarded | 51.7% → **0.0%** (CI 0–6%) | 10.0% → **0.0%** (CI 0–6%) |
| Unauthorized calls proposed (guarded) | 44: 40 blocked, 4 review, **0 allowed** | 9: 6 blocked, 3 review, **0 allowed** |
| Calls to destinations the user never gave, executed | 19 → **0** | 0 → **0** (6 proposed, all blocked) |
| Legit task completion, unguarded / guarded | 80.6% / 100% | 22.2% / 58.3% |
| Legit calls blocked (FP) | 4.7% (4/85) | **53.9% (55/102)** |
| LLM turn p50 | 9.2 s | 9.1 s |

**Reading.** On both models no unauthorized call was allowed. The models differ a lot as agents: llama3.2:3b follows injections less often, but it often calls tools with missing or malformed arguments (e.g. `read_documents()` with no ids); strict schema validation blocks those, which shows up as a high false-positive rate. Those blocks are correct per the schema but cost task completion; guarded completion is still higher than unguarded because actionable errors let the model retry. Not yet investigated per case. The earlier qwen run on frozen `078b567` (66.7% → 0%) is kept unchanged in [benchmark-llm-v2-holdout.md](benchmark-llm-v2-holdout.md); runs differ across code versions and are not pooled. Small models, self-authored scenarios, correlated runs: these are not general security claims.
