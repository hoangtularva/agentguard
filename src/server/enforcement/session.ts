import { eq } from "drizzle-orm";
import { extractDestinations, makeSource, normalizeValue } from "@/server/core/provenance";
import { MandateSchema, type ProvenanceSource, type UserRole, maxSensitivity } from "@/server/core/types";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { writeAudit } from "./audit";
import { newId } from "./ids";
import type { Identity } from "./policy-input";
import type { EnforcementDeps } from "./ports";
import type { ExecResult, ProposedToolCall, SessionState } from "./types";

export interface StartSessionParams {
  userId: string;
  agentId: string;
  prompt: string;
  mandate: { allowedTools: string[]; resourceScope: string[]; destinations?: string[] };
  planner: string;
  origin?: "playground" | "benchmark" | "api";
  policyId: string;
}

/**
 * Start an agent session. The mandate is the user's explicit authorization:
 * selected tools ∩ the agent's registered tools, selected resource scope, and
 * destinations the user typed in the (trusted) prompt or added explicitly.
 */
export async function startSession(deps: EnforcementDeps, params: StartSessionParams): Promise<SessionState> {
  const { db } = deps;
  const [user] = await db.select().from(s.users).where(eq(s.users.id, params.userId)).limit(1);
  if (!user) throw new Error("Unknown user");
  const [agent] = await db.select().from(s.agents).where(eq(s.agents.id, params.agentId)).limit(1);
  if (!agent || !agent.active) throw new Error("Unknown or inactive agent");

  const destinations = [
    ...new Set([...(params.mandate.destinations ?? []).map(normalizeValue), ...extractDestinations(params.prompt)]),
  ];
  const mandate = MandateSchema.parse({
    allowedTools: params.mandate.allowedTools.filter((t) => agent.allowedTools.includes(t) && deps.tools.get(t)),
    resourceScope: params.mandate.resourceScope,
    destinations,
  });

  const id = newId("ses");
  await db.insert(s.agentSessions).values({
    id,
    userId: user.id,
    agentId: agent.id,
    userPrompt: params.prompt,
    mandate,
    planner: params.planner,
    status: "running",
    origin: params.origin ?? "playground",
  });
  const state: SessionState = {
    id,
    userId: user.id,
    agentId: agent.id,
    policyId: params.policyId,
    mandate,
    sources: [],
    readSensitivity: "public",
  };
  await addSource(db, state, makeSource({ type: "user_prompt", label: "User request", content: params.prompt }));
  await writeAudit(db, {
    type: "session.started",
    sessionId: id,
    actorId: user.id,
    payload: { agentId: agent.id, planner: params.planner, mandate },
  });
  return state;
}

/** Track a source in memory (for matching) and persist only its hash and labels. */
export async function addSource(db: DB, state: SessionState, src: ProvenanceSource) {
  state.sources.push(src);
  await db.insert(s.provenanceSources).values({
    id: src.id,
    sessionId: state.id,
    type: src.type,
    trust: src.trust,
    label: src.label,
    contentHash: src.contentHash,
    sensitivity: src.sensitivity,
    signals: src.signals,
    relatedToolCallId: src.relatedToolCallId ?? null,
  });
}

/** Register what a tool returned as UNTRUSTED provenance (data, never instructions). */
export async function ingestOutput(db: DB, state: SessionState, toolCallId: string, tool: string, exec: ExecResult) {
  if (tool === "read_documents") {
    for (const item of exec.readItems) {
      await addSource(
        db,
        state,
        makeSource({
          type: item.sourceType,
          label: item.id,
          content: item.content,
          sensitivity: item.sensitivity,
          relatedToolCallId: toolCallId,
        }),
      );
      state.readSensitivity = maxSensitivity([state.readSensitivity, item.sensitivity]);
    }
    return;
  }
  await addSource(
    db,
    state,
    makeSource({ type: "tool_output", label: `${tool} result`, content: exec.output, relatedToolCallId: toolCallId }),
  );
}

/** Identity: the session row is the source of truth, not the caller's claim. */
export async function verifyIdentity(db: DB, state: SessionState, call: ProposedToolCall): Promise<Identity> {
  const [row] = await db.select().from(s.agentSessions).where(eq(s.agentSessions.id, state.id)).limit(1);
  const [user] = row ? await db.select().from(s.users).where(eq(s.users.id, row.userId)).limit(1) : [];
  const [agent] = row ? await db.select().from(s.agents).where(eq(s.agents.id, row.agentId)).limit(1) : [];
  return {
    userOk: !!row && !!user && row.userId === state.userId,
    agentOk: !!row && !!agent && agent.active && row.agentId === call.agentId && agent.allowedTools.includes(call.tool),
    userRole: (user?.role ?? "member") as UserRole,
  };
}
