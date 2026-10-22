CREATE TABLE "app_data" (
	"installation_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_data_installation_id_key_pk" PRIMARY KEY("installation_id","key")
);
--> statement-breakpoint
CREATE TABLE "instance_keys" (
	"kid" text PRIMARY KEY NOT NULL,
	"private_key" text NOT NULL,
	"public_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "public_key" text;--> statement-breakpoint
ALTER TABLE "app_data" ADD CONSTRAINT "app_data_installation_id_app_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."app_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_installations" DROP COLUMN "session_secret";--> statement-breakpoint
ALTER TABLE "apps" DROP COLUMN "client_secret_hash";