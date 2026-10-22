CREATE TABLE "storefront_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"name" text NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	CONSTRAINT "storefront_keys_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "storefront_keys" ADD CONSTRAINT "storefront_keys_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;