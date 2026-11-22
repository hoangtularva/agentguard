# @callwrit/mcp-gateway

Put Callwrit in front of **any MCP server** without changing the client or the server:

```
Claude Desktop / Claude Code / Cursor / any MCP client
        │  stdio
        ▼
callwrit-mcp  ── POST /v1/check ──▶ Callwrit (ALLOW / REVIEW / BLOCK)
        │  only allowed calls (with a decision token in _meta)
        ▼
upstream MCP server (stdio or Streamable HTTP)
```

- **Least privilege:** only tools listed in `tools` are exposed; each declares its role (`source`/`sink`, `risk`, and for sinks the `destinationArg`). The ToolSpec sent to Callwrit is the upstream `inputSchema` plus this role.
- **The mandate is the operator's**, from the config file (`task`, `mandate`). Nothing the model sends can widen it.
- **Tool results are untrusted provenance:** an address that only appears in a fetched page or email can't become an allowed recipient.
- **REVIEW** holds the call up to `approvalWaitSeconds` while a human decides in the Approval Inbox (0 = return an error at once). **BLOCK** returns `isError: true` with reasons. Callwrit unreachable ⇒ nothing is forwarded.

## Use with Claude Desktop

```bash
npm run admin -- create-app desktop "My desktop"
npm run admin -- create-key desktop gateway --scopes check
npm run admin -- create-key desktop gateway-admin --scopes admin   # lets the gateway register its tools
```

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "email (guarded)": {
      "command": "node",
      "args": ["/path/to/callwrit/packages/mcp-gateway/dist/cli.js", "/path/to/callwrit-mcp.json"],
      "env": { "CALLWRIT_API_KEY": "agk_…", "CALLWRIT_ADMIN_KEY": "agk_…" }
    }
  }
}
```

Claude Code: `claude mcp add email-guarded -- node /path/to/dist/cli.js /path/to/callwrit-mcp.json`.

See [callwrit-mcp.example.json](callwrit-mcp.example.json). Values written as `env:NAME` are read from the environment, so keys never sit in the config file.

**Limits:** one Callwrit session per gateway process (the operator's task); per-conversation mandates need the SDK instead. Destination checks see argument values, not paraphrases.
