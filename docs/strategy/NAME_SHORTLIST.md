# Name shortlist (2026-11-22)

Block 1, task 1. About 40 candidates checked; the 5 below survived. **Owner picks one.**

How checked: npm registry (`registry.npmjs.org/<name>` → 404), PyPI JSON API (→ 404), `.dev` via Google Registry RDAP and `.io` via Identity Digital RDAP (→ 404 = not registered), GitHub repository search and account lookup (`gh api`), and web search for products and trademark records with the same or a similar name.

| # | Name | Idea | npm | PyPI | .dev | .io | GitHub repos / account | Similar names found | Risk |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Callwrit** | a *writ* (written authority) for every tool call; matches the signed decision token | free | free | free | free | 4 unrelated "callwriter" repos / free | `CALLWRITER` US trademark for pens, cancelled | **low** |
| 2 | **Tollwrit** | a toll gate that issues a writ before passage | free | free | free | free | 0 / free | none | **low** (meaning less obvious) |
| 3 | **Writguard** | guard that demands a writ | free | free | free | free | 0 / free | "WriteGuard", "RewriteGuard" (writing tools) | low–medium (sounds like "write guard") |
| 4 | **Actwarden** | warden of agent actions | free | free | free | free | 0 / free | Warden Protocol's `x/act` module (crypto, action approvals) | medium |
| 5 | **Vetogate** | veto at the gate, before a side effect | free | free | free | free | 0 / free | **Vectogate**, an AI-agent governance platform launched July 2026 | **high** (one letter from a competitor) |

Spare names, also free on npm, PyPI, `.dev` and `.io` with no GitHub account taken: `Writmark`, `Onusguard`.

Rejected because the same name is already used for AI-agent security or approval tools: `agentwarrant`, `callwarden`, `warrantor`, `gatehold`, `gatewarden`/`toolwarden` (PyPI taken), plus many common words already on npm/PyPI (`countersign`, `proviso`, `bailiff`, `tollgate`, `attestor`, `portcullis`, `plumbline`, ...).

## Recommendation

**Callwrit**: short, says what the product does (authority per call), every identifier free, no AI-security conflict found. Packages would be `callwrit` (npm), `@callwrit/*` scope, `callwrit` (PyPI), `callwrit-mcp` for `npx`.

## Not yet verified (owner, before committing to a name)

- **Trademark databases**: WIPO Global Brand Database and USPTO search are interactive sites; only web search for trademark records was done here. Search the chosen name there (classes 9 and 42) once.
- **npm scope**: an organisation's availability is only confirmed when creating it on npmjs.com (Block 2, task 5). No package under `@callwrit/` exists today.
- **Domains**: RDAP "not found" means not registered at check time; register the chosen `.dev` soon after picking.

Sources: [Vectogate launch (Help Net Security)](https://www.helpnetsecurity.com/2026/07/09/vectogate-ai-governance-platform/), [CALLWRITER trademark (Justia)](https://trademark.justia.com/746/82/callwriter-74682093.html), [Warden Protocol x/act](https://docs.wardenprotocol.org/learn/warden-protocol-modules/x-act).
