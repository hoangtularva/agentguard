CREATE TABLE "active_policy" (
	"policy_id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"user_prompt" text NOT NULL,
	"mandate" jsonb NOT NULL,
	"planner" text NOT NULL,
	"status" text NOT NULL,
	"final_message" text,
	"origin" text DEFAULT 'playground' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"allowed_tools" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"tool_call_id" text NOT NULL,
	"session_id" text NOT NULL,
	"requested_for" text NOT NULL,
	"binding_hash" text NOT NULL,
	"policy_id" text NOT NULL,
	"policy_version" integer NOT NULL,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"session_id" text,
	"tool_call_id" text,
	"actor_id" text,
	"decision" text,
	"reason_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	"results" jsonb NOT NULL,
	"duration_ms" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corpus_items" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"source_type" text NOT NULL,
	"sensitivity" text NOT NULL,
	"content" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" text PRIMARY KEY NOT NULL,
	"tool_call_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"approval_id" text,
	"ok" boolean NOT NULL,
	"result_summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"policy_id" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"document" jsonb NOT NULL,
	"document_hash" text NOT NULL,
	"change_note" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provenance_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"type" text NOT NULL,
	"trust" text NOT NULL,
	"label" text NOT NULL,
	"content_hash" text NOT NULL,
	"sensitivity" text NOT NULL,
	"signals" jsonb NOT NULL,
	"related_tool_call_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sandbox_effects" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"tool_call_id" text NOT NULL,
	"tool" text NOT NULL,
	"destination" text NOT NULL,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"tool" text NOT NULL,
	"args_redacted" jsonb NOT NULL,
	"args_hash" text NOT NULL,
	"pending_args" jsonb,
	"decision" text NOT NULL,
	"reasons" jsonb NOT NULL,
	"matched_rule_ids" jsonb NOT NULL,
	"risk_score" integer NOT NULL,
	"policy_id" text NOT NULL,
	"policy_version" integer NOT NULL,
	"provenance" jsonb NOT NULL,
	"status" text NOT NULL,
	"rationale" text,
	"eval_latency_ms" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_tool_call_id_tool_calls_id_fk" FOREIGN KEY ("tool_call_id") REFERENCES "public"."tool_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_tool_call_id_tool_calls_id_fk" FOREIGN KEY ("tool_call_id") REFERENCES "public"."tool_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provenance_sources" ADD CONSTRAINT "provenance_sources_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_tool_call_uq" ON "approvals" USING btree ("tool_call_id");--> statement-breakpoint
CREATE INDEX "approvals_status_idx" ON "approvals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_session_idx" ON "audit_events" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "executions_tool_call_uq" ON "executions" USING btree ("tool_call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "executions_idem_uq" ON "executions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_version_uq" ON "policy_versions" USING btree ("policy_id","version");--> statement-breakpoint
CREATE INDEX "prov_session_idx" ON "provenance_sources" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "tool_calls_session_idx" ON "tool_calls" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "tool_calls_created_idx" ON "tool_calls" USING btree ("created_at");