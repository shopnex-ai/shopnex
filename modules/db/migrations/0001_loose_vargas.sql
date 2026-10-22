CREATE TABLE "shop_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"domain" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shop_domains_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "shop_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"team_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_members" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "shops_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "active_shop_id" text;--> statement-breakpoint
-- Hand-edited: create the default shop and backfill existing data into it
INSERT INTO "shops" ("id", "name", "slug") VALUES ('default', 'My Shop', 'default') ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "shop_id" text NOT NULL DEFAULT 'default';--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "shop_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "shop_domains" ADD CONSTRAINT "shop_domains_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_invitations" ADD CONSTRAINT "shop_invitations_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_invitations" ADD CONSTRAINT "shop_invitations_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_members" ADD CONSTRAINT "shop_members_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_members" ADD CONSTRAINT "shop_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shop_members_shop_user_idx" ON "shop_members" USING btree ("shop_id","user_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_shop_created_idx" ON "products" USING btree ("shop_id","created_at");;--> statement-breakpoint
-- Hand-edited: existing users join the default shop; the earliest user becomes owner
INSERT INTO "shop_members" ("id", "shop_id", "user_id", "role")
SELECT gen_random_uuid()::text, 'default', u."id",
       CASE WHEN row_number() OVER (ORDER BY u."created_at") = 1 THEN 'owner' ELSE 'member' END
FROM "user" u
ON CONFLICT DO NOTHING;