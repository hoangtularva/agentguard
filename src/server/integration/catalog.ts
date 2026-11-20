import { and, desc, eq } from "drizzle-orm";
import { type CompiledTool, type ToolSpecInput, compileToolSpec } from "../../../packages/core/src/tool-spec";
import { globMatch } from "@/server/core/glob";
import { SensitivitySchema } from "@/server/core/types";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import type { ResourceResolver, ToolCatalog } from "@/server/enforcement/ports";

/** Compiled specs are immutable per row id, so compiling once per process is safe. */
const g = globalThis as unknown as { __agSpecCache?: Map<string, CompiledTool> };
const compiled = (id: string, spec: unknown) => {
  g.__agSpecCache ??= new Map();
  let c = g.__agSpecCache.get(id);
  if (!c) g.__agSpecCache.set(id, (c = compileToolSpec(spec as ToolSpecInput)));
  return c;
};

/** Active (latest version per name) ToolSpecs of an external app. */
export async function toolCatalogFor(db: DB, appId: string): Promise<ToolCatalog> {
  const rows = await db
    .select()
    .from(s.toolSpecs)
    .where(and(eq(s.toolSpecs.appId, appId), eq(s.toolSpecs.active, true)))
    .orderBy(desc(s.toolSpecs.version));
  const byName = new Map<string, CompiledTool>();
  for (const r of rows) if (!byName.has(r.name)) byName.set(r.name, compiled(r.id, r.spec));
  return { get: (name) => byName.get(name) };
}

/**
 * Resource sensitivity from the app's labels (highest priority, then most specific pattern).
 * AgentGuard cannot see an external app's data, so unlabelled resources are assumed to exist
 * with the app's default sensitivity (setting `defaultSensitivity`, else "internal"). The
 * mandate's resource scope still bounds what the agent may touch.
 */
export async function resourceResolverFor(db: DB, appId: string, settings: Record<string, unknown>): Promise<ResourceResolver> {
  const labels = (await db.select().from(s.resourceLabels).where(eq(s.resourceLabels.appId, appId))).sort(
    (a, b) => b.priority - a.priority || b.pattern.length - a.pattern.length,
  );
  const fallback = SensitivitySchema.catch("internal").parse(settings.defaultSensitivity);
  return {
    resolve: (id) => ({ exists: true, sensitivity: labels.find((l) => globMatch(l.pattern, id))?.sensitivity ?? fallback }),
  };
}
