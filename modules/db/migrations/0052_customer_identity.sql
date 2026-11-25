CREATE TABLE "customer_login_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" text NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_login_codes" ADD CONSTRAINT "customer_login_codes_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_login_codes_shop_email_idx" ON "customer_login_codes" USING btree ("shop_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_sessions_token_idx" ON "customer_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "customer_sessions_customer_idx" ON "customer_sessions" USING btree ("customer_id");--> statement-breakpoint
-- GHSA-w9q2-8c32-gmhm: customers used to be rows of the staff `user` table, and a code asked for through one shop signed in
-- as the same address anywhere. Everything signed in that way is untrusted, so every session ends once (staff sign in again).
DELETE FROM "session";--> statement-breakpoint
-- Customers are not users any more: unlink them, and remove the users that only ever existed for a customer sign-in (no
-- shop membership, no password or OAuth login, not a platform admin).
UPDATE "customers" SET "user_id" = NULL WHERE "user_id" IS NOT NULL;--> statement-breakpoint
DELETE FROM "user" u
WHERE u."role" IS DISTINCT FROM 'superadmin'
  AND NOT EXISTS (SELECT 1 FROM "shop_members" m WHERE m."user_id" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "account" a WHERE a."user_id" = u."id");
