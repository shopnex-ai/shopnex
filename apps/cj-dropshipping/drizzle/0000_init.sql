CREATE TABLE "app_cj"."cj_orders" (
	"instance" text NOT NULL,
	"shop_id" text NOT NULL,
	"order_id" text NOT NULL,
	"order_number" integer NOT NULL,
	"cj_order_id" text,
	"status" text NOT NULL,
	"error" text,
	"tracking_number" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cj_orders_instance_shop_id_order_id_pk" PRIMARY KEY("instance","shop_id","order_id")
);
--> statement-breakpoint
CREATE TABLE "app_cj"."cj_product_status" (
	"instance" text NOT NULL,
	"shop_id" text NOT NULL,
	"pid" text NOT NULL,
	"available" boolean NOT NULL,
	"checked_at" bigint NOT NULL,
	CONSTRAINT "cj_product_status_instance_shop_id_pid_pk" PRIMARY KEY("instance","shop_id","pid")
);
--> statement-breakpoint
CREATE TABLE "app_cj"."cj_variants" (
	"instance" text NOT NULL,
	"shop_id" text NOT NULL,
	"sku" text NOT NULL,
	"pid" text NOT NULL,
	"vid" text NOT NULL,
	CONSTRAINT "cj_variants_instance_shop_id_sku_pk" PRIMARY KEY("instance","shop_id","sku")
);
