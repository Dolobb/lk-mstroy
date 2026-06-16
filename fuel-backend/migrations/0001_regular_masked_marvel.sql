ALTER TABLE "atz" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;