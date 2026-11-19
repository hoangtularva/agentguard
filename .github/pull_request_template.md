## What & why

## Security impact
- [ ] Changes policy/PEP/approval/provenance semantics → tests added that fail without this change
- [ ] No rule relaxed to pass a benchmark
- [ ] No real secrets or personal data added

## Checks
- [ ] `npm run lint && npm run typecheck`
- [ ] `npm test`
- [ ] `npm run test:e2e` (if UI/API changed)
