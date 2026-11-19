CREATE TABLE "app_reviews"."review_requests" (
	"token" text PRIMARY KEY NOT NULL,
	"instance" text NOT NULL,
	"shop_id" text NOT NULL,
	"order_id" text NOT NULL,
	"product_id" text NOT NULL,
	"product_title" text NOT NULL,
	"email" text NOT NULL,
	"send_after" bigint NOT NULL,
	"sent_at" bigint,
	"used_at" bigint,
	"created_at" bigint NOT NULL,
	CONSTRAINT "review_requests_order_product_key" UNIQUE("instance","shop_id","order_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "app_reviews"."reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"instance" text NOT NULL,
	"shop_id" text NOT NULL,
	"token" text NOT NULL,
	"product_id" text NOT NULL,
	"product_title" text NOT NULL,
	"rating" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"author" text NOT NULL,
	"verified" boolean NOT NULL,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "reviews_token_unique" UNIQUE("token"),
	CONSTRAINT "reviews_rating_range" CHECK ("app_reviews"."reviews"."rating" between 1 and 5)
);
--> statement-breakpoint
CREATE INDEX "review_requests_due_idx" ON "app_reviews"."review_requests" USING btree ("sent_at","used_at","send_after");--> statement-breakpoint
CREATE INDEX "reviews_product_idx" ON "app_reviews"."reviews" USING btree ("instance","shop_id","product_id","status");