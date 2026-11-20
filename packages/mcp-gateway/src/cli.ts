#!/usr/bin/env node
/**
 * agentguard-mcp <config.json>
 *
 * Runs as a stdio MCP server for the client, and launches the upstream MCP server (stdio) or
 * connects to it (Streamable HTTP). Secrets stay out of the config file: values written as
 * "env:NAME" are read from the environment.
 */
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type GatewayConfig, McpGateway } from "./gateway";

type FileConfig = GatewayConfig & {
  upstream: { command: string; args?: string[]; env?: Record<string, string> } | { url: string };
};

const resolveEnv = (v: unknown): unknown => {
  if (typeof v === "string" && v.startsWith("env:")) {
    const val = process.env[v.slice(4)];
    if (!val) throw new Error(`Environment variable ${v.slice(4)} is not set`);
    return val;
  }
  if (Array.isArray(v)) return v.map(resolveEnv);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveEnv(x)]));
  return v;
};

async function main() {
  const file = process.argv[2] ?? process.env.AGENTGUARD_MCP_CONFIG;
  if (!file) throw new Error("usage: agentguard-mcp <config.json>");
  const cfg = resolveEnv(JSON.parse(fs.readFileSync(file, "utf8"))) as FileConfig;

  const upstream = new Client({ name: "agentguard-gateway", version: "0.1.0" });
  await upstream.connect(
    "url" in cfg.upstream
      ? new StreamableHTTPClientTransport(new URL(cfg.upstream.url))
      : new StdioClientTransport({ command: cfg.upstream.command, args: cfg.upstream.args, env: { ...process.env, ...cfg.upstream.env } as Record<string, string> }),
  );
  const gateway = new McpGateway(cfg, upstream);
  await gateway.start();
  await gateway.server.connect(new StdioServerTransport());
  // Logs go to stderr: stdout is the MCP channel.
  console.error(`[agentguard-mcp] guarding ${Object.keys(cfg.tools).length} tool(s) via ${cfg.agentguard.baseUrl}`);
}

main().catch((e) => {
  console.error(`[agentguard-mcp] ${(e as Error).message}`);
  process.exit(1);
});
