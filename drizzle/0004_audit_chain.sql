ALTER TABLE "audit_events" ADD COLUMN "chain_pos" integer;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "chain_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_chain_pos_uq" ON "audit_events" USING btree ("chain_pos");--> statement-breakpoint
CREATE INDEX "audit_unsealed_idx" ON "audit_events" USING btree ("created_at") WHERE "audit_events"."chain_pos" is null;