CREATE TABLE "project_sunsets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"version" text NOT NULL,
	"after" text NOT NULL,
	"message" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_sunsets" ADD CONSTRAINT "project_sunsets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_sunsets_project_version_unique" ON "project_sunsets" USING btree ("project_id","version");--> statement-breakpoint
CREATE INDEX "project_sunsets_project_id_idx" ON "project_sunsets" USING btree ("project_id");