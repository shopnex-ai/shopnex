CREATE TABLE "app_policy" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"require_approval" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "approved_by_id" text;--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_approved_by_id_user_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;