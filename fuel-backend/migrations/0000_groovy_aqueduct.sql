CREATE TABLE "atz" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gos_number" text NOT NULL,
	"title" text,
	"tis_vehicle_id" text,
	"remaining_liters" numeric(10, 2) DEFAULT '0',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"login" text NOT NULL,
	"pin_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "drivers_login_unique" UNIQUE("login")
);
--> statement-breakpoint
CREATE TABLE "event_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"edited_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fuel_dispense_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"shift_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"liters" numeric(10, 2) NOT NULL,
	"happened_at_client" timestamp with time zone NOT NULL,
	"received_at_server" timestamp with time zone DEFAULT now(),
	"is_deleted" boolean DEFAULT false,
	"edited_at" timestamp with time zone,
	"device_id" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fuel_receipt_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"shift_id" uuid NOT NULL,
	"liters" numeric(10, 2) NOT NULL,
	"ttn_photo_path" text,
	"ttn_photo_status" text DEFAULT 'pending',
	"happened_at_client" timestamp with time zone NOT NULL,
	"received_at_server" timestamp with time zone DEFAULT now(),
	"is_deleted" boolean DEFAULT false,
	"device_id" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "fuel_receipt_events_ttn_photo_status_check" CHECK ("fuel_receipt_events"."ttn_photo_status" in ('pending', 'uploaded'))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"tis_org_id" integer,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "organizations_tis_org_id_unique" UNIQUE("tis_org_id"),
	CONSTRAINT "organizations_kind_check" CHECK ("organizations"."kind" in ('internal', 'hired')),
	CONSTRAINT "organizations_source_check" CHECK ("organizations"."source" in ('seed', 'tis', 'driver', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"driver_id" uuid NOT NULL,
	"atz_id" uuid NOT NULL,
	"started_at_client" timestamp with time zone NOT NULL,
	"started_at_server" timestamp with time zone DEFAULT now(),
	"ended_at_client" timestamp with time zone,
	"ended_at_server" timestamp with time zone,
	"status" text DEFAULT 'open',
	"opening_remaining_liters" numeric(10, 2),
	"closing_remaining_liters" numeric(10, 2),
	"device_id" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "shifts_status_check" CHECK ("shifts"."status" in ('open', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gos_number" text NOT NULL,
	"mark" text,
	"vehicle_type" text,
	"organization_id" uuid NOT NULL,
	"source" text NOT NULL,
	"tis_id" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "vehicles_tis_id_unique" UNIQUE("tis_id"),
	CONSTRAINT "vehicles_source_check" CHECK ("vehicles"."source" in ('tis', 'driver', 'admin'))
);
--> statement-breakpoint
ALTER TABLE "fuel_dispense_events" ADD CONSTRAINT "fuel_dispense_events_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_dispense_events" ADD CONSTRAINT "fuel_dispense_events_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_receipt_events" ADD CONSTRAINT "fuel_receipt_events_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_atz_id_atz_id_fk" FOREIGN KEY ("atz_id") REFERENCES "public"."atz"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_edits_event_id_idx" ON "event_edits" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "fuel_dispense_events_shift_id_idx" ON "fuel_dispense_events" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "fuel_receipt_events_shift_id_idx" ON "fuel_receipt_events" USING btree ("shift_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_open_shift_per_atz" ON "shifts" USING btree ("atz_id") WHERE "shifts"."status" = 'open';--> statement-breakpoint
CREATE INDEX "shifts_driver_id_idx" ON "shifts" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "vehicles_organization_id_idx" ON "vehicles" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "vehicles_gos_number_idx" ON "vehicles" USING btree ("gos_number");