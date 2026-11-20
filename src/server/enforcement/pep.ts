/**
 * Policy Enforcement Point (PEP), a Facade over the enforcement use cases.
 *
 * The ONLY production path from an agent's proposed tool call to a tool executor:
 *   validate args -> verify identities -> resolve resources -> trace provenance
 *   -> PDP decision -> persist + audit -> ALLOW: execute | REVIEW: bind approval | BLOCK: refuse
 *
 * This file is the composition point for the built-in demo app: it adapts the demo tool
 * registry, corpus and mock executors to the ports in `./ports`. It is the only module
 * (besides the benchmark baseline) allowed to import executors (ESLint + boundaries test).
 */
import type { Corpus } from "@/server/core/types";
import type { DB } from "@/server/db/client";
import { getExecutor } from "@/server/tools/executors";
import { getTool } from "@/server/tools/registry";
import { checkToolCall } from "./check-tool-call";
import { type ExecuteApprovedParams, executeApproved } from "./execute-approved";
import type { PolicyResolver } from "./policy-store";
import type { EnforcementDeps, ResourceResolver, ToolRunner } from "./ports";
import { type StartSessionParams, ingestOutput, startSession } from "./session";
import type { ExecResult, ProposedToolCall, SessionState } from "./types";

export type * from "./types";

export interface PepOptions {
  corpus: Corpus;
  resolvePolicy: PolicyResolver;
  now?: () => Date;
}

/** Adapter: resources are corpus items; unknown ids are treated as missing and restricted. */
export const corpusResources = (corpus: Corpus): ResourceResolver => ({
  resolve: (id) => {
    const item = corpus.get(id);
    return { exists: !!item, sensitivity: item?.sensitivity ?? "restricted" };
  },
});

/** Adapter: the in-process mock executors (sandbox effects only). */
const mockRunner = (corpus: Corpus): ToolRunner => ({
  run: (tool, args, ctx) => {
    const executor = getExecutor(tool);
    if (!executor) throw new Error(`No executor for ${tool}`);
    return executor(args, { ...ctx, corpus });
  },
});

export class EnforcementPoint {
  private readonly deps: EnforcementDeps;

  constructor(db: DB, opts: PepOptions) {
    this.deps = {
      db,
      tools: { get: getTool },
      resources: corpusResources(opts.corpus),
      runner: mockRunner(opts.corpus),
      resolvePolicy: opts.resolvePolicy,
      clock: { now: opts.now ?? (() => new Date()) },
      appId: "demo",
    };
  }

  startSession(params: StartSessionParams): Promise<SessionState> {
    return startSession(this.deps, params);
  }

  /** Enforce a single proposed tool call. Never throws for policy outcomes. */
  enforce(state: SessionState, call: ProposedToolCall) {
    return checkToolCall(this.deps, state, call);
  }

  ingestOutput(state: SessionState, toolCallId: string, tool: string, exec: ExecResult) {
    return ingestOutput(this.deps.db, state, toolCallId, tool, exec);
  }

  executeApprovedAction(params: ExecuteApprovedParams) {
    return executeApproved(this.deps, params);
  }
}
