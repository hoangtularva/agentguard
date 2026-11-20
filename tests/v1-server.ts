import http from "node:http";
import type { AddressInfo } from "node:net";
import { PUT as putAgent } from "@/app/v1/agents/[id]/route";
import { GET as getApproval } from "@/app/v1/approvals/[id]/route";
import { POST as consume } from "@/app/v1/approvals/[id]/consume/route";
import { POST as result } from "@/app/v1/calls/[id]/result/route";
import { POST as check } from "@/app/v1/check/route";
import { POST as sources } from "@/app/v1/sessions/[id]/sources/route";
import { POST as sessions } from "@/app/v1/sessions/route";
import { POST as verify } from "@/app/v1/tokens/verify/route";
import { PUT as putTool } from "@/app/v1/tools/[name]/route";

/**
 * The real /v1 route handlers behind a plain Node HTTP server (no Next.js), so SDKs can be
 * tested end-to-end over HTTP in a test process.
 */
type H = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
/** [method, pattern, handler, name of the captured path parameter] */
const ROUTES: [string, RegExp, H, string?][] = [
  ["POST", /^\/v1\/sessions$/, sessions],
  ["POST", /^\/v1\/sessions\/([^/]+)\/sources$/, sources, "id"],
  ["POST", /^\/v1\/check$/, check],
  ["GET", /^\/v1\/approvals\/([^/]+)$/, getApproval as H, "id"],
  ["POST", /^\/v1\/approvals\/([^/]+)\/consume$/, consume, "id"],
  ["POST", /^\/v1\/calls\/([^/]+)\/result$/, result, "id"],
  ["POST", /^\/v1\/tokens\/verify$/, verify],
  ["PUT", /^\/v1\/tools\/([^/]+)$/, putTool, "name"],
  ["PUT", /^\/v1\/agents\/([^/]+)$/, putAgent, "id"],
];

export async function startV1Server(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const path = (req.url ?? "/").split("?")[0];
    for (const [method, re, handler, param] of ROUTES) {
      const m = re.exec(path);
      if (!m || method !== req.method) continue;
      const params: Record<string, string> = param ? { [param]: decodeURIComponent(m[1]) } : {};
      const r = await handler(
        new Request(`http://localhost${req.url}`, {
          method,
          headers: req.headers as Record<string, string>,
          body: chunks.length && method !== "GET" ? Buffer.concat(chunks) : undefined,
        }),
        { params: Promise.resolve(params) },
      );
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" }).end('{"error":"not_found"}');
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) };
}
