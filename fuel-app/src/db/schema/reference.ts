import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  source: text("source").notNull(),
});

export const vehicles = sqliteTable(
  "vehicles",
  {
    id: text("id").primaryKey(),
    gosNumber: text("gos_number").notNull(),
    gosNumberNorm: text("gos_number_norm").notNull(),
    mark: text("mark"),
    vehicleType: text("vehicle_type"),
    organizationId: text("organization_id").notNull(),
    source: text("source").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull(),
  },
  (table) => [
    index("vehicles_gos_number_norm_idx").on(table.gosNumberNorm),
    index("vehicles_organization_id_idx").on(table.organizationId),
  ],
);

export const atz = sqliteTable("atz", {
  id: text("id").primaryKey(),
  gosNumber: text("gos_number").notNull(),
  title: text("title"),
  remainingLiters: real("remaining_liters").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull(),
});

export const shifts = sqliteTable("shifts", {
  id: text("id").primaryKey(),
  atzId: text("atz_id").notNull(),
  atzGosNumber: text("atz_gos_number"),
  startedAtClient: text("started_at_client").notNull(),
  endedAtClient: text("ended_at_client"),
  status: text("status").notNull(),
  openingRemainingLiters: real("opening_remaining_liters"),
  closingRemainingLiters: real("closing_remaining_liters"),
  dispenseCount: integer("dispense_count"),
  dispenseLiters: real("dispense_liters"),
  receiptLiters: real("receipt_liters"),
});

export const syncMeta = sqliteTable("sync_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
