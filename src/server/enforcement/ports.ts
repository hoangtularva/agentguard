import type { CompiledTool } from "../../../packages/core/src/tool-spec";
import type { Sensitivity } from "@/server/core/types";
import type { DB } from "@/server/db/client";
import type { PolicyResolver } from "./policy-store";
import type { ExecResult, SandboxEffect } from "./types";

/**
 * Ports (Hexagonal architecture). Use cases depend only on these interfaces; adapters
 * (demo corpus, mock executors, external apps' registries) are wired in the composition root.
 */

/** Which tools exist and how to validate their arguments. */
export interface ToolCatalog {
  get(name: string): CompiledTool | undefined;
}

/** Existence and sensitivity of a resource id. Unknown resources must resolve to exists:false. */
export interface ResourceResolver {
  resolve(id: string): { exists: boolean; sensitivity: Sensitivity };
}

/** Performs a tool's side effect. Absent in decision-only mode (external apps execute themselves). */
export interface ToolRunner {
  run(
    tool: string,
    args: Record<string, unknown>,
    ctx: { sessionId: string; toolCallId: string; recordEffect: (e: SandboxEffect) => Promise<void> },
  ): Promise<ExecResult>;
}

/** Issues signed, single-use decision tokens (decision-only mode: the host app executes). */
export interface DecisionTokenIssuer {
  issue(
    tx: DB,
    call: { appId: string; agentId: string; toolCallId: string; tool: string; args: Record<string, unknown> },
  ): Promise<{ token: string; expiresAt: Date }>;
}

export interface Clock {
  now(): Date;
}

/** Everything a use case needs. One object, built once per request by the composition root. */
export interface EnforcementDeps {
  db: DB;
  tools: ToolCatalog;
  resources: ResourceResolver;
  /** Absent = decision-only mode: ALLOW issues a decision token instead of executing. */
  runner?: ToolRunner;
  tokens?: DecisionTokenIssuer;
  /** Containment limits (per app). */
  limits?: { maxSinkCallsPerSession?: number };
  /** Tenant this instance acts for; approvals of other apps are invisible to it. */
  appId?: string;
  resolvePolicy: PolicyResolver;
  clock: Clock;
}
