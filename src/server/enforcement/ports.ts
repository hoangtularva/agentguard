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

export interface Clock {
  now(): Date;
}

/** Everything a use case needs. One object, built once per request by the composition root. */
export interface EnforcementDeps {
  db: DB;
  tools: ToolCatalog;
  resources: ResourceResolver;
  runner?: ToolRunner;
  resolvePolicy: PolicyResolver;
  clock: Clock;
}
