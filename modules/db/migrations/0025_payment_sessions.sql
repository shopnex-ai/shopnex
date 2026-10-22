CREATE TABLE "payment_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" text NOT NULL,
	"order_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	"payment_method_id" uuid,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"redirect_url" text,
	"external_id" text,
	"error_message" text,
	"transaction_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "app_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "gateway" text;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "ready" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "payment_session_url" text;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "refund_session_url" text;--> statement-breakpoint
ALTER TABLE "payment_sessions" ADD CONSTRAINT "payment_sessions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sessions" ADD CONSTRAINT "payment_sessions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sessions" ADD CONSTRAINT "payment_sessions_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sessions" ADD CONSTRAINT "payment_sessions_payment_method_id_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sessions" ADD CONSTRAINT "payment_sessions_transaction_id_order_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."order_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_sessions_order_idx" ON "payment_sessions" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_sessions_pending_idx" ON "payment_sessions" USING btree ("status","expires_at");--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_shop_app_idx" ON "payment_methods" USING btree ("shop_id","app_id");