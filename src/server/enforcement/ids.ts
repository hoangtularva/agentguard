import { randomUUID } from "node:crypto";

/** Prefixed, URL-safe random id, e.g. `tc_3f9a…` (20 hex chars of entropy). */
export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
