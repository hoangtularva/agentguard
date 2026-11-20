ALTER TABLE "agent_sessions" ADD COLUMN "policy_id" text;--> statement-breakpoint
ALTER TABLE "provenance_sources" ADD COLUMN "fingerprints" jsonb DEFAULT '[]'::jsonb NOT NULL;