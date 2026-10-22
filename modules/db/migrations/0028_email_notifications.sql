CREATE TABLE "email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" text NOT NULL,
	"notification" text NOT NULL,
	"order_id" uuid,
	"to" text NOT NULL,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"shop_id" text NOT NULL,
	"notification" text NOT NULL,
	"subject" text,
	"body" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_templates_shop_id_notification_pk" PRIMARY KEY("shop_id","notification")
);
--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_deliveries_due_idx" ON "email_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "email_deliveries_shop_created_idx" ON "email_deliveries" USING btree ("shop_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_deliveries_order_once_idx" ON "email_deliveries" USING btree ("order_id","notification","to") WHERE "email_deliveries"."order_id" is not null;