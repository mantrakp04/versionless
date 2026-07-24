CREATE TABLE IF NOT EXISTS "telemetry_ingest_keys" (
	"fingerprint" text PRIMARY KEY NOT NULL,
	"team_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "telemetry_ingest_keys" ADD CONSTRAINT "telemetry_ingest_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "telemetry_ingest_keys_project_id_idx" ON "telemetry_ingest_keys" USING btree ("project_id");
