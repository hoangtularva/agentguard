# Global distribution readiness

*Question: can a developer abroad **find**, **install**, **understand** and **use** AgentGuard without the author's help? Checked 2026-11-22 at commit `f78ef01`. Constraint for every recommendation: one maintainer, under 5 hours a week.*

## Verdict

**Install and use: mostly ready. Find: not ready, and the name is the main blocker.**

A developer who already has the repository URL can be running in about two minutes (fresh clone + `npm ci` in 98 s, then `npm run dev`, no database to set up). English docs, an OpenAPI spec, runnable examples and a demo video exist. But nobody can discover it or install the SDKs the way developers expect (`npm install`, `pip install`). The name "AgentGuard" is already taken in the places that matter.

## 1. Find

| Check | Status | Evidence |
|---|---|---|
| **Name collision** | ❌ **Blocker** | npm scope `@agentguard` is owned by another project (`@agentguard/sdk` 0.1.4, homepage `agentguard.dev`); `@agentguardx/*` is another product; PyPI `agentguard-sdk` 0.3.0 belongs to another project (renamed TealTiger); GitHub search for "agentguard" returns at least 8 other repositories (top one ≈ 495 stars, also an "AI agent security" tool). This repository is not among the top results |
| Repository description, topics, homepage | ❌ | GitHub API: `description: null`, `topics: []`, `homepage: null` |
| Releases / tags | ❌ | 0 releases, 0 tags |
| Stars / social proof | 2 stars, 0 forks | — |
| Launch content (Show HN post, Product Hunt page, blog post) | ❌ | none |
| Listed in MCP / AI-agent directories | ❌ | none |

The collision hurts in three ways: search results point to other products, package names are unavailable, and two "AgentGuard" security tools for AI agents invite trademark trouble and confusion. **Rename before any public launch** (cheapest moment: now, with 2 stars and no published packages). Check a candidate name on npm, PyPI, GitHub search, a domain registrar and a trademark search (e.g. WIPO Global Brand Database) before committing.

## 2. Install

| Check | Status | Evidence |
|---|---|---|
| Clone → run, no external services | ✅ | fresh clone check: `npm ci` 98 s, `next dev` serves `/` and `/v1/health` (200) |
| Docker | ✅ but build-from-source | `docker compose up --build` needs `AUTH_SECRET` and builds locally (several minutes); **no published image** |
| SDKs via package managers | ❌ | not on npm or PyPI; only `npm run package` tarballs/wheel |
| MCP gateway via `npx` | ❌ | requires cloning the repo; a published package would allow `npx <name>-mcp config.json` |
| OS coverage of docs | ⚠️ | the detailed setup guide is `docs/setup-windows.md`; macOS/Linux users rely on the short README commands (they work, but untested here on those OSes; CI runs on Linux) |
| Versioning / changelog | ❌ | everything is `0.1.0`; no `CHANGELOG.md` |

## 3. Understand

| Check | Status | Evidence |
|---|---|---|
| English README with screenshots, results, honest limits | ✅ | `README.md` |
| 10-second answer to "what is it / why should I care" | ⚠️ | first screen is good, but the README mixes the portfolio demo (Playground, Attack Lab, benchmarks) with the integration product; an integrator must scroll to "Integrate with your agents" |
| Integration guide, OpenAPI, examples | ✅ | `docs/INTEGRATION_GUIDE.md`, `docs/openapi.json`, `examples/` (tested in CI) |
| Demo video | ⚠️ | `docs/media/demo.webm` is a repository file; GitHub will not play it inline from a relative link. Upload it to the README via the GitHub editor (user-attachments) or convert key moments to a GIF |
| Docs site | ❌ (not needed yet) | Markdown in the repo is enough at this stage |
| Non-English content | ⚠️ minor | `docs/learning-notes.md` is Vietnamese (fine, labelled); some planning docs are internal and clutter `docs/` |

## 4. Use

| Check | Status | Evidence |
|---|---|---|
| Create an app and keys without the author | ✅ | Apps & API keys UI, `npm run admin` |
| Guard an agent in TS / Python / MCP | ✅ | SDK READMEs, examples |
| Team use (more than one person) | ❌ | demo identities only, no SSO (audit F3) |
| Get help / report security issues | ✅ / ⚠️ | `SECURITY.md`, issue templates; Discussions disabled; with < 5 h/week, response times must be stated |
| Upgrade path | ⚠️ | migrations upgrade in place (tested), but no versioned releases to upgrade between |

## 5. What to do, in order (fits < 5 h/week)

| # | Action | Effort | Why first |
|---|---|---|---|
| 1 | **Choose a new name** and check npm/PyPI/GitHub/domain/trademark availability | 2–3 h | Everything below carries the name; renaming later costs users and links |
| 2 | Rename in repo and packages; set GitHub description, topics (`ai-agents`, `mcp`, `ai-security`, `llm`, `authorization`), homepage | 3–4 h | Discoverability; mostly search-and-replace + tests |
| 3 | **Fix audit F1** (agent-bound keys) before telling anyone to use keys per agent | 2 h incl. tests | It weakens a documented guarantee |
| 4 | Publish the TS SDK, core and MCP gateway to npm, the Python SDK to PyPI (from CI with provenance, under the new name) | 3–4 h | `npm install` / `pip install` / `npx` is how developers try tools |
| 5 | First GitHub Release `v0.2.0` with `CHANGELOG.md`; publish the Docker image to GHCR from CI | 2–3 h | Something concrete to link, upgrade and cite |
| 6 | README: a short "integrate in 5 minutes" path at the top (MCP gateway + SDK), move the portfolio material lower; embed the video properly | 2–3 h | First impression for integrators |
| 7 | Default demo identities **off** in compose files, with a clear "local evaluation" profile (audit F3) | 1 h | Safe defaults for people who deploy what they download |
| 8 | Launch: one Show HN post and one technical write-up (the provenance + bound-approval design, the honest benchmark), then MCP/AI directories | 3–4 h | Only after 1–7, so first visitors can install and trust it |

Deliberately **not** now: a docs website, a hosted SaaS, a marketplace listing that requires a verified organisation, payment integration (no evidence yet of what anyone would pay for), Product Hunt (better after early users and feedback).

## Decisions needed from the owner

1. **New name**: approve a rename and pick from candidates (to be researched and checked for availability).
2. **Publishing**: approve creating npm and PyPI accounts/organisations and publishing packages (outward-facing, permanent version numbers).
3. **Paid parts**: the server is AGPL-3.0 and the SDKs MIT (see [LICENSING.md](../../LICENSING.md)); decide later, from user feedback, whether to offer a commercial license or paid add-ons in a separate package.
4. **Support promise**: state publicly what response time a < 5 h/week maintainer can offer (e.g. "best effort, security reports within 7 days").
