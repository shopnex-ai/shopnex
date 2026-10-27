CREATE TABLE "entity_drafts" (
	"shop_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rev" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "entity_drafts_shop_id_entity_type_entity_id_pk" PRIMARY KEY("shop_id","entity_type","entity_id")
);
--> statement-breakpoint
ALTER TABLE "entity_drafts" ADD CONSTRAINT "entity_drafts_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;