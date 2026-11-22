# @callwrit/core

Pure, deterministic building blocks of Callwrit (no network, no database):

- `evaluatePolicy(input, policy)` — Policy Decision Point (invariants → rules → default deny)
- `compileToolSpec(spec)` — register any tool with JSON Schema + security metadata (Ajv-validated, unknown args always rejected)
- `traceArgument`, `extractDestinations`, `makeSource` — value-level provenance
- `computeBindingHash`, `canonicalJson` — approval binding
- `redactArgs` — audit redaction

Use it embedded in a TypeScript agent for offline decisions, or through the Callwrit server/SDKs for audit, approvals and multi-agent provenance.
