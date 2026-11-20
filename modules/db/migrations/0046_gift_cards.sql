CREATE TABLE "gift_card_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gift_card_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"balance_after_cents" integer NOT NULL,
	"order_id" uuid,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gift_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" text NOT NULL,
	"code" text NOT NULL,
	"currency" text NOT NULL,
	"initial_cents" integer NOT NULL,
	"balance_cents" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"recipient_email" text,
	"purchase_order_id" uuid,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "is_gift_card" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_gift_card_id_gift_cards_id_fk" FOREIGN KEY ("gift_card_id") REFERENCES "public"."gift_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gift_card_transactions_card_idx" ON "gift_card_transactions" USING btree ("gift_card_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_cards_shop_code_idx" ON "gift_cards" USING btree ("shop_id","code");