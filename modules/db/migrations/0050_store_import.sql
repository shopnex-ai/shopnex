CREATE TABLE "store_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" text NOT NULL,
	"origin" text NOT NULL,
	"platform" text,
	"status" text DEFAULT 'running' NOT NULL,
	"step" text DEFAULT 'Starting' NOT NULL,
	"done" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"counts" jsonb,
	"problems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "store_imports" ADD CONSTRAINT "store_imports_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_imports_shop_idx" ON "store_imports" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "store_imports_one_running_idx" ON "store_imports" USING btree ("shop_id") WHERE "store_imports"."status" = 'running';