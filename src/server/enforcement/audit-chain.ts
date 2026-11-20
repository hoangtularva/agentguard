/**
 * Tamper-evident audit log (hash chain).
 *
 * Writers never wait for the chain: events are inserted as usual and a sealer later assigns
 * each committed, unsealed event the next chain position and
 *   chain_hash = sha256(previous chain_hash ‖ canonical(event))
 * under a transaction-scoped advisory lock (one sealer at a time). Editing or deleting a sealed
 * event, or reordering the chain, breaks verification from that position on.
 *
 * Limits: rows can be altered before they are sealed (seconds), and cutting off the newest
 * events is only detectable against an externally recorded head (`head` from verifyAuditChain).
 */
import { asc, desc, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { canonicalJson, sha256 } from "@/server/core/canonical";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";

type Event = typeof s.auditEvents.$inferSelect;
const LOCK_ID = 7_424_242; // advisory lock key reserved for the sealer
const GENESIS = "0".repeat(64);

/** The exact fields covered by the chain (everything except the chain columns themselves). */
function eventDigest(prev: string, e: Event): string {
  const { chainPos: _p, chainHash: _h, ...fields } = e;
  return sha256(prev + canonicalJson({ ...fields, createdAt: e.createdAt.toISOString() }));
}

/** Seal up to `limit` unsealed events in insertion order. Returns how many were sealed. */
export async function sealAuditChain(db: DB, limit = 1000): Promise<number> {
  return db.transaction(async (raw) => {
    const tx = raw as unknown as DB;
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_ID})`);
    const [head] = await tx
      .select({ pos: s.auditEvents.chainPos, hash: s.auditEvents.chainHash })
      .from(s.auditEvents)
      .where(isNotNull(s.auditEvents.chainPos))
      .orderBy(desc(s.auditEvents.chainPos))
      .limit(1);
    const rows = await tx
      .select()
      .from(s.auditEvents)
      .where(isNull(s.auditEvents.chainPos))
      .orderBy(asc(s.auditEvents.createdAt), asc(s.auditEvents.id))
      .limit(limit);
    let pos = head?.pos ?? 0;
    let prev = head?.hash ?? GENESIS;
    for (const e of rows) {
      pos += 1;
      prev = eventDigest(prev, e);
      await tx.update(s.auditEvents).set({ chainPos: pos, chainHash: prev }).where(sql`${s.auditEvents.id} = ${e.id}`);
    }
    return rows.length;
  });
}

export type ChainVerdict =
  | { ok: true; length: number; head: string; unsealed: number }
  | { ok: false; length: number; brokenAt: number; reason: string; unsealed: number };

/** Recompute the whole chain. Reports the first position where it breaks. */
export async function verifyAuditChain(db: DB, pageSize = 1000): Promise<ChainVerdict> {
  const [{ unsealed }] = await db
    .select({ unsealed: sql<number>`count(*)::int` })
    .from(s.auditEvents)
    .where(isNull(s.auditEvents.chainPos));
  let prev = GENESIS;
  let expected = 1;
  for (;;) {
    const page = await db
      .select()
      .from(s.auditEvents)
      .where(gt(s.auditEvents.chainPos, expected - 1))
      .orderBy(asc(s.auditEvents.chainPos))
      .limit(pageSize);
    if (page.length === 0) return { ok: true, length: expected - 1, head: prev, unsealed };
    for (const e of page) {
      if (e.chainPos !== expected) return { ok: false, length: expected - 1, brokenAt: expected, reason: "missing event (gap in the chain)", unsealed };
      const h = eventDigest(prev, e);
      if (h !== e.chainHash) return { ok: false, length: expected - 1, brokenAt: expected, reason: "event content or order changed after sealing", unsealed };
      prev = h;
      expected += 1;
    }
  }
}

/** Background sealing for a long-running server (unref'd: never keeps the process alive). */
export function startAuditSealer(db: DB, everyMs = 2000): () => void {
  let busy = false;
  const t = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      while ((await sealAuditChain(db)) === 1000);
    } catch (err) {
      console.error("[audit-chain] sealing failed (will retry):", (err as Error).message);
    } finally {
      busy = false;
    }
  }, everyMs);
  t.unref?.();
  return () => clearInterval(t);
}
