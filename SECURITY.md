# Security policy

Callwrit is a **research / portfolio project**. It is not production-ready. Read [docs/threat-model.md](docs/threat-model.md) and [docs/security-boundaries.md](docs/security-boundaries.md) before using any part of it to protect real systems.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private vulnerability reporting instead: *Security → Report a vulnerability* on this repository. Include:

- affected component (policy engine, PEP, approvals, API, UI, SDK, MCP gateway)
- reproduction steps against a **local** deployment with synthetic data
- the impact you observed

You should get an acknowledgement within 7 days. Fixed issues are listed in `docs/PHASE*_FINDINGS.md` along with a regression test.

## Scope

In scope: bypassing policy decisions, approval replay or tampering, cross-user or cross-app data access, secret or content leakage into logs, injection into the UI or API.
Out of scope: the demo identity switcher (it is documented as **not** authentication), denial of service against a local laptop, and findings that need a modified server.

Never test against systems you don't own.
