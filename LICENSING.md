# Licensing

AgentGuard uses two licenses so that anyone can integrate it freely, while improvements to the server itself stay open.

| Part | Path | License | Why |
|---|---|---|---|
| Server, web UI, `/v1` API, database, benchmarks, scripts, examples | everything not listed below | **AGPL-3.0-only** ([LICENSE](LICENSE)) | If you modify AgentGuard and let others use it, including over a network, you share those changes |
| MCP gateway | `packages/mcp-gateway` | **AGPL-3.0-only** ([LICENSE](packages/mcp-gateway/LICENSE)) | Part of the enforcement infrastructure |
| Core decision library | `packages/core` | **MIT** ([LICENSE](packages/core/LICENSE)) | Embeddable in any project |
| TypeScript SDK and decision-token verifier | `packages/sdk-ts` | **MIT** ([LICENSE](packages/sdk-ts/LICENSE)) | Goes inside your app; must not impose a license on it |
| Python SDK and verifier | `sdk/python` | **MIT** ([LICENSE](sdk/python/LICENSE)) | Same |

**What this means in practice**

- Using the SDKs or the core library in your own application, open or closed source, has no copyleft effect: they are MIT.
- Running an unmodified AgentGuard server for your team is fine under the AGPL; you have no extra obligations.
- If you **modify** the AgentGuard server or MCP gateway and make it available to others (including as a hosted service), you must offer them the source of your modified version under the AGPL.
- Talking to the AgentGuard server over its HTTP API does not make your application a derivative work of the server.

**Commercial licensing.** The copyright holder can offer the AGPL-covered parts under separate commercial terms for organisations that cannot use the AGPL. Contact: open an issue titled "Commercial licensing" (no private details in the issue).

*This file explains the intent; the license texts are what apply. It is not legal advice.*
