CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"agent_id" text,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "apps" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"default_policy_id" text NOT NULL,
	"token_key_version" integer DEFAULT 1 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"tool_call_id" text NOT NULL,
	"args_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_labels" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"pattern" text NOT NULL,
	"sensitivity" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_specs" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"spec" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "active_policy" ADD COLUMN "app_id" text DEFAULT 'demo' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD COLUMN "app_id" text DEFAULT 'demo' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "app_id" text DEFAULT 'demo' NOT NULL;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "app_id" text DEFAULT 'demo' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "app_id" text DEFAULT 'demo' NOT NULL;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD COLUMN "app_id" text DEFAULT 'demo' NOT NULL;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD COLUMN "app_id" text DEFAULT 'demo' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_tokens" ADD CONSTRAINT "decision_tokens_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_labels" ADD CONSTRAINT "resource_labels_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_specs" ADD CONSTRAINT "tool_specs_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_uq" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_app_idx" ON "api_keys" USING btree ("app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_tokens_call_uq" ON "decision_tokens" USING btree ("tool_call_id");--> statement-breakpoint
CREATE INDEX "resource_labels_app_idx" ON "resource_labels" USING btree ("app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_specs_version_uq" ON "tool_specs" USING btree ("app_id","name","version");--> statement-breakpoint
CREATE INDEX "tool_specs_app_idx" ON "tool_specs" USING btree ("app_id");--> statement-breakpoint
INSERT INTO "apps" ("id", "name", "created_by", "default_policy_id") VALUES ('demo', 'Built-in demo', 'system', 'default') ON CONFLICT ("id") DO NOTHING;
