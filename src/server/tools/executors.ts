/**
 * Tool executors (side effects). SECURITY BOUNDARY:
 * Only `src/server/enforcement/pep.ts` (and the clearly separated, benchmark-only
 * unguarded baseline in `src/server/bench/baseline.ts`) may import this module.
 * Enforced by ESLint `no-restricted-imports` and by tests/unit/boundaries.test.ts.
 *
 * All tools are MOCKS: emails go to a sandbox outbox, exports are recorded, nothing
 * leaves the process.
 */
import { digest, redactString } from "@/server/core/redact";
import type { Corpus, CorpusItem } from "@/server/core/types";
import type { ExecResult, SandboxEffect } from "@/server/enforcement/types";

export type { Corpus };

export type { ExecResult, SandboxEffect };

export interface ToolExecContext {
  sessionId: string;
  toolCallId: string;
  corpus: Corpus;
  recordEffect: (effect: SandboxEffect) => Promise<void>;
}

type Executor = (args: Record<string, unknown>, ctx: ToolExecContext) => Promise<ExecResult>;

const readDocuments: Executor = async (args, ctx) => {
  const ids = args.documentIds as string[];
  const items = ids.map((id) => ctx.corpus.get(id)).filter((x): x is CorpusItem => !!x);
  const output = items
    .map((d) => `<document id="${d.id}" title="${d.title}" source="${d.sourceType}">\n${d.content}\n</document>`)
    .join("\n");
  return {
    ok: true,
    output,
    readItems: items,
    summary: { documents: items.map((d) => ({ id: d.id, sensitivity: d.sensitivity, ...digest(d.content) })) },
  };
};

const sendEmail: Executor = async (args, ctx) => {
  const to = String(args.to);
  const summary = { to, subject: redactString(String(args.subject)), body: digest(String(args.body)) };
  await ctx.recordEffect({ tool: "send_email", destination: to, summary });
  return { ok: true, output: `Email queued in sandbox outbox for ${to}.`, summary, readItems: [] };
};

const exportData: Executor = async (args, ctx) => {
  const dataset = ctx.corpus.get(String(args.dataset));
  if (!dataset) return { ok: false, output: "Dataset not found.", summary: { error: "not_found" }, readItems: [] };
  const destination = String(args.destination);
  const rows = Math.max(0, dataset.content.split("\n").length - 1);
  const summary = { dataset: dataset.id, destination, format: args.format, rows, ...digest(dataset.content) };
  await ctx.recordEffect({ tool: "export_data", destination, summary });
  return { ok: true, output: `Export of ${dataset.id} (${rows} rows) recorded in sandbox.`, summary, readItems: [] };
};

const EXECUTORS: Record<string, Executor> = {
  read_documents: readDocuments,
  send_email: sendEmail,
  export_data: exportData,
};

export function getExecutor(tool: string): Executor | undefined {
  return Object.prototype.hasOwnProperty.call(EXECUTORS, tool) ? EXECUTORS[tool] : undefined;
}
