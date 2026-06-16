import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

export const drivers = pgTable("drivers", {
  id: uuid("id").primaryKey().defaultRandom(),
  login: text("login").notNull().unique(),
  pinHash: text("pin_hash").notNull(),
  fullName: text("full_name").notNull(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});

export const atz = pgTable("atz", {
  id: uuid("id").primaryKey().defaultRandom(),
  gosNumber: text("gos_number").notNull(),
  title: text("title"),
  tisVehicleId: text("tis_vehicle_id"),
  remainingLiters: numeric("remaining_liters", { precision: 10, scale: 2 }).default("0"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
});

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    source: text("source").notNull(),
    tisOrgId: integer("tis_org_id").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    check("organizations_kind_check", sql`${table.kind} in ('internal', 'hired')`),
    check("organizations_source_check", sql`${table.source} in ('seed', 'tis', 'driver', 'admin')`)
  ]
);

export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gosNumber: text("gos_number").notNull(),
    mark: text("mark"),
    vehicleType: text("vehicle_type"),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    source: text("source").notNull(),
    tisId: text("tis_id").unique(),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    check("vehicles_source_check", sql`${table.source} in ('tis', 'driver', 'admin')`),
    index("vehicles_organization_id_idx").on(table.organizationId),
    index("vehicles_gos_number_idx").on(table.gosNumber)
  ]
);

export const shifts = pgTable(
  "shifts",
  {
    id: uuid("id").primaryKey(),
    driverId: uuid("driver_id")
      .notNull()
      .references(() => drivers.id),
    atzId: uuid("atz_id")
      .notNull()
      .references(() => atz.id),
    startedAtClient: timestamp("started_at_client", { withTimezone: true }).notNull(),
    startedAtServer: timestamp("started_at_server", { withTimezone: true }).defaultNow(),
    endedAtClient: timestamp("ended_at_client", { withTimezone: true }),
    endedAtServer: timestamp("ended_at_server", { withTimezone: true }),
    status: text("status").default("open"),
    openingRemainingLiters: numeric("opening_remaining_liters", { precision: 10, scale: 2 }),
    closingRemainingLiters: numeric("closing_remaining_liters", { precision: 10, scale: 2 }),
    deviceId: text("device_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
  },
  (table) => [
    check("shifts_status_check", sql`${table.status} in ('open', 'closed')`),
    uniqueIndex("uniq_open_shift_per_atz").on(table.atzId).where(sql`${table.status} = 'open'`),
    index("shifts_driver_id_idx").on(table.driverId)
  ]
);

export const fuelDispenseEvents = pgTable(
  "fuel_dispense_events",
  {
    id: uuid("id").primaryKey(),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => shifts.id),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id),
    liters: numeric("liters", { precision: 10, scale: 2 }).notNull(),
    // Фамилия И.О. получателя топлива (вводится на экране передачи). DEFAULT '' — бэкафилл
    // существующих строк; для новых событий непустоту гарантирует sync.types.ts (min 1).
    recipientName: text("recipient_name").notNull().default(""),
    happenedAtClient: timestamp("happened_at_client", { withTimezone: true }).notNull(),
    receivedAtServer: timestamp("received_at_server", { withTimezone: true }).defaultNow(),
    isDeleted: boolean("is_deleted").default(false),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deviceId: text("device_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
  },
  (table) => [index("fuel_dispense_events_shift_id_idx").on(table.shiftId)]
);

export const fuelReceiptEvents = pgTable(
  "fuel_receipt_events",
  {
    id: uuid("id").primaryKey(),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => shifts.id),
    liters: numeric("liters", { precision: 10, scale: 2 }).notNull(),
    ttnPhotoPath: text("ttn_photo_path"),
    ttnPhotoStatus: text("ttn_photo_status").default("pending"),
    happenedAtClient: timestamp("happened_at_client", { withTimezone: true }).notNull(),
    receivedAtServer: timestamp("received_at_server", { withTimezone: true }).defaultNow(),
    isDeleted: boolean("is_deleted").default(false),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deviceId: text("device_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
  },
  (table) => [
    check("fuel_receipt_events_ttn_photo_status_check", sql`${table.ttnPhotoStatus} in ('pending', 'uploaded')`),
    index("fuel_receipt_events_shift_id_idx").on(table.shiftId)
  ]
);

export const eventEdits = pgTable(
  "event_edits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").notNull(),
    eventType: text("event_type").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    editedAt: timestamp("edited_at", { withTimezone: true }).defaultNow()
  },
  (table) => [index("event_edits_event_id_idx").on(table.eventId)]
);
