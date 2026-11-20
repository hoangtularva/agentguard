import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDatabase } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { writeAudit } from "@/server/enforcement/audit";
import { eventDigest, sealAuditChain, verifyAuditChain } from "@/server/enforcement/audit-chain";

async function seeded(n: number) {
  const db = await createDatabase({ pgliteDir: "memory" });
  for (let i = 0; i < n; i++) await writeAudit(db, { type: "tool_call.evaluated", decision: "ALLOW", payload: { i, nested: { b: 1, a: [i] } } });
  return db;
}
const nth = async (db: Awaited<ReturnType<typeof seeded>>, pos: number) =>
  (await db.select().from(s.auditEvents).where(eq(s.auditEvents.chainPos, pos)))[0];

describe("tamper-evident audit chain", () => {
  it("seals in order and verifies; later events extend the chain", async () => {
    const db = await seeded(5);
    expect(await sealAuditChain(db)).toBe(5);
    const v1 = await verifyAuditChain(db);
    expect(v1).toMatchObject({ ok: true, length: 5, unsealed: 0 });
    await writeAudit(db, { type: "policy.activated", payload: { v: 2 } });
    expect((await verifyAuditChain(db)).unsealed).toBe(1);
    expect(await sealAuditChain(db)).toBe(1);
    const v2 = await verifyAuditChain(db);
    expect(v2).toMatchObject({ ok: true, length: 6 });
    expect(v2.ok && v1.ok && v2.head !== v1.head).toBe(true);
    expect(await sealAuditChain(db)).toBe(0); // idempotent
  });

  it("detects an edited payload, a changed decision and a deleted event", async () => {
    const db = await seeded(6);
    await sealAuditChain(db);
    const third = await nth(db, 3);
    await db.update(s.auditEvents).set({ payload: { i: 999 } }).where(eq(s.auditEvents.id, third.id));
    expect(await verifyAuditChain(db)).toMatchObject({ ok: false, brokenAt: 3 });

    const db2 = await seeded(6);
    await sealAuditChain(db2);
    await db2.update(s.auditEvents).set({ decision: "BLOCK" }).where(eq(s.auditEvents.id, (await nth(db2, 5)).id));
    expect(await verifyAuditChain(db2)).toMatchObject({ ok: false, brokenAt: 5 });

    const db3 = await seeded(6);
    await sealAuditChain(db3);
    await db3.delete(s.auditEvents).where(eq(s.auditEvents.id, (await nth(db3, 2)).id));
    expect(await verifyAuditChain(db3)).toMatchObject({ ok: false, brokenAt: 2, reason: expect.stringMatching(/missing/) });
  });

  it("detects re-hashing an edited event without re-chaining its successors", async () => {
    const db = await seeded(4);
    await sealAuditChain(db);
    // An attacker edits event #2 and recomputes ITS hash: #3 no longer follows.
    await db.execute(sql`update audit_events set payload = '{"i":42}'::jsonb where chain_pos = 2`);
    const rows = await db.select().from(s.auditEvents).orderBy(s.auditEvents.chainPos);
    const forged = eventDigest(rows[0].chainHash!, rows[1]);
    await db.update(s.auditEvents).set({ chainHash: forged }).where(eq(s.auditEvents.id, rows[1].id));
    expect(await verifyAuditChain(db)).toMatchObject({ ok: false, brokenAt: 3 });
  });
});
