/**
 * AgentGuard MCP gateway: an MCP server that sits between any MCP client (Claude Desktop,
 * Claude Code, Cursor, an agent framework) and an upstream MCP server. Every `tools/call`
 * is checked by AgentGuard first; only allowed calls reach the upstream server, and their
 * results are registered as untrusted provenance. No code changes in client or server.
 *
 * Trust model: the task mandate (tools, resources, destinations) comes from the gateway's
 * configuration, which the operator controls. Nothing the model sends can widen it.
 */
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, type CallToolResult, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { AgentGuard, AgentGuardBlockedError, ApprovalRequiredError, type Session } from "../../sdk-ts/src/index";

export interface ToolRole {
  kind: "source" | "sink";
  risk: "low" | "medium" | "high" | "critical";
  /** Sinks: the argument naming where data goes (recipient, URL, path, channel…). */
  destinationArg?: string;
  resourceArg?: string;
  contentArgs?: string[];
}

export interface GatewayConfig {
  agentguard: { baseUrl: string; apiKey: string; adminKey?: string; timeoutMs?: number };
  /** Agent identity registered in AgentGuard for this gateway. */
  agentId: string;
  userRef: string;
  /** The operator's description of the task: emails/URLs in it become authorized destinations. */
  task: string;
  mandate?: { resources?: string[]; destinations?: string[] };
  /**
   * Upstream tools to expose, with their security role. Tools not listed here are hidden: an
   * unconfigured tool is never callable (least privilege).
   */
  tools: Record<string, ToolRole>;
  /** REVIEW: hold the MCP call while a human decides (default 300 s), or fail immediately (0). */
  approvalWaitSeconds?: number;
}

const text = (t: string, isError = false): CallToolResult => ({ content: [{ type: "text", text: t }], isError });
const outputText = (r: CallToolResult) =>
  (r.content ?? []).map((c) => (c.type === "text" ? c.text : c.type === "resource" && "text" in c.resource ? String(c.resource.text) : "")).join("\n");

export class McpGateway {
  readonly server: Server;
  private session?: Session;
  private exposed: Tool[] = [];

  constructor(
    private readonly cfg: GatewayConfig,
    private readonly upstream: Client,
    private readonly ag = new AgentGuard({ baseUrl: cfg.agentguard.baseUrl, apiKey: cfg.agentguard.apiKey, timeoutMs: cfg.agentguard.timeoutMs }),
  ) {
    this.server = new Server({ name: "agentguard-gateway", version: "0.1.0" }, { capabilities: { tools: {} } });
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: this.exposed }));
    this.server.setRequestHandler(CallToolRequestSchema, (req) => this.call(req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>));
  }

  /** Discover upstream tools, register the configured ones (if an admin key is given) and open the session. */
  async start(): Promise<void> {
    const { tools } = await this.upstream.listTools();
    this.exposed = tools.filter((t) => Object.hasOwn(this.cfg.tools, t.name));
    if (this.cfg.agentguard.adminKey) await this.register(this.exposed);
    this.session = await this.ag.startSession({
      userRef: this.cfg.userRef,
      agentId: this.cfg.agentId,
      prompt: this.cfg.task,
      mandate: { tools: this.exposed.map((t) => t.name), resources: this.cfg.mandate?.resources, destinations: this.cfg.mandate?.destinations },
    });
  }

  /** ToolSpec = the upstream MCP inputSchema + the operator's security role for the tool. */
  private async register(tools: Tool[]) {
    const admin = new AgentGuard({ baseUrl: this.cfg.agentguard.baseUrl, apiKey: this.cfg.agentguard.adminKey! });
    for (const t of tools) {
      const role = this.cfg.tools[t.name];
      await admin.request("PUT", `/v1/tools/${encodeURIComponent(t.name)}`, {
        name: t.name,
        description: (t.description ?? "").slice(0, 2000),
        inputSchema: t.inputSchema,
        ...role,
      });
    }
    await admin.request("PUT", `/v1/agents/${encodeURIComponent(this.cfg.agentId)}`, { name: `MCP gateway (${this.cfg.agentId})`, allowedTools: tools.map((t) => t.name) });
  }

  async call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    if (!this.session) return text("AgentGuard gateway is not started.", true);
    if (!Object.hasOwn(this.cfg.tools, name)) return text(`Tool "${name}" is not exposed by this gateway.`, true);
    const wait = this.cfg.approvalWaitSeconds ?? 300;
    let upstreamResult: CallToolResult | undefined;
    const run = this.session.guard(
      name,
      async (a, ctx) => {
        const r = (await this.upstream.callTool({ name, arguments: a, _meta: { agentguardDecisionToken: ctx.decisionToken } })) as CallToolResult;
        upstreamResult = r;
        return outputText(r);
      },
      { waitForApproval: wait > 0 ? { timeoutMs: wait * 1000, intervalMs: 1000 } : false, readOnly: this.cfg.tools[name].kind === "source" },
    );
    try {
      await run(args);
      return upstreamResult ?? text("");
    } catch (err) {
      if (err instanceof ApprovalRequiredError)
        return text(`AgentGuard: approval required (${err.approvalId}). A human must approve this call in the AgentGuard Approval Inbox. Reasons: ${err.reasons.map((r) => r.message).join(" ")}`, true);
      if (err instanceof AgentGuardBlockedError)
        return text(`AgentGuard blocked this call (${err.decision}). ${err.reasons.map((r) => `[${r.code}] ${r.message}`).join(" ")} Do not retry with different wording; ask the user.`, true);
      return text(`Upstream tool failed: ${(err as Error).message}`, true);
    }
  }
}
