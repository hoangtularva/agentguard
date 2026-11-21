# Policies as code

| Template | For |
|---|---|
| [starter.yaml](templates/starter.yaml) | What every new app gets: reads up to confidential run; sends only to destinations the user gave (low/medium risk, data ≤ internal) run; high risk or confidential → human; restricted never leaves; injection signals escalate |
| [strict-approvals.yaml](templates/strict-approvals.yaml) | Every outbound action needs a human; confidential data never leaves |
| [internal-only.yaml](templates/internal-only.yaml) | Outbound actions only to company domains (edit the patterns) |

Each template has unit tests in [tests/](tests/): a few fields describe a call, `expect` states the decision, and the real decision engine runs it. Everything not given defaults to a valid, in-mandate, identity-verified call.

```bash
npm run policy -- test policies/templates/starter.yaml policies/tests/starter.cases.yaml   # CI-friendly, no database
npm run policy -- export myapp.default myapp.yaml                                          # active version → YAML
npm run policy -- import myapp.default myapp.yaml --activate --note "PR #12"               # new immutable version
```

Review policy changes in pull requests like code: edit the YAML, add a case, let CI run the tests, then import. Rules combine as BLOCK > REVIEW > ALLOW with default deny; `escalateOnly` rules can raise a decision but never grant one.
