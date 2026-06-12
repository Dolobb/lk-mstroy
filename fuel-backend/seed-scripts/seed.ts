import { readFile } from "node:fs/promises";

import { count, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { db, pool } from "../src/db/client.js";
import { organizations, vehicles } from "../src/db/schema.js";

const BATCH_SIZE = 500;

const organizationSeedSchema = z.object({
  tis_org_id: z.number().int(),
  name: z.string().nullable(),
  kind: z.literal("internal"),
  vehicle_count: z.number().int()
});

const vehicleSeedSchema = z.object({
  tis_id: z.number().int(),
  gos_number: z.string(),
  mark: z.string().nullable(),
  vehicle_type: z.string().nullable(),
  tis_org_id: z.number().int(),
  source: z.literal("tis")
});

const atzCandidateSchema = z.object({
  gos_number: z.string(),
  mark: z.string().nullable()
});

type UpsertCounts = {
  inserted: number;
  updated: number;
};

async function readSeedJson<T>(fileName: string, schema: z.ZodType<T>): Promise<T> {
  const fileUrl = new URL(`../seed/${fileName}`, import.meta.url);
  const raw = await readFile(fileUrl, "utf8");
  return schema.parse(JSON.parse(raw));
}

function countReturnedRows(rows: Array<{ inserted: boolean }>): UpsertCounts {
  return rows.reduce<UpsertCounts>(
    (acc, row) => {
      if (row.inserted) {
        acc.inserted += 1;
      } else {
        acc.updated += 1;
      }

      return acc;
    },
    { inserted: 0, updated: 0 }
  );
}

function addCounts(left: UpsertCounts, right: UpsertCounts): UpsertCounts {
  return {
    inserted: left.inserted + right.inserted,
    updated: left.updated + right.updated
  };
}

function toBatches<T>(rows: T[], batchSize: number): T[][] {
  const batches: T[][] = [];

  for (let index = 0; index < rows.length; index += batchSize) {
    batches.push(rows.slice(index, index + batchSize));
  }

  return batches;
}

async function seedOrganizations(): Promise<UpsertCounts> {
  const organizationSeeds = await readSeedJson(
    "organizations-seed.json",
    z.array(organizationSeedSchema)
  );

  const rows = organizationSeeds.map((organizationSeed) => ({
    name: organizationSeed.name ?? `TIS-организация ${organizationSeed.tis_org_id}`,
    kind: organizationSeed.kind,
    source: "seed",
    tisOrgId: organizationSeed.tis_org_id
  }));

  const returnedRows = await db
    .insert(organizations)
    .values(rows)
    .onConflictDoUpdate({
      target: organizations.tisOrgId,
      set: {
        name: sql`excluded.name`,
        kind: sql`excluded.kind`,
        updatedAt: sql`now()`
      }
    })
    .returning({ inserted: sql<boolean>`xmax = 0` });

  return countReturnedRows(returnedRows);
}

async function getOrganizationIdByTisOrgId(): Promise<Map<number, string>> {
  const organizationRows = await db
    .select({
      id: organizations.id,
      tisOrgId: organizations.tisOrgId
    })
    .from(organizations)
    .where(inArray(organizations.tisOrgId, await getVehicleTisOrgIds()));

  const idByTisOrgId = new Map<number, string>();

  for (const organizationRow of organizationRows) {
    if (organizationRow.tisOrgId !== null) {
      idByTisOrgId.set(organizationRow.tisOrgId, organizationRow.id);
    }
  }

  return idByTisOrgId;
}

async function getVehicleTisOrgIds(): Promise<number[]> {
  const vehicleSeeds = await readSeedJson("vehicles-seed.json", z.array(vehicleSeedSchema));
  return [...new Set(vehicleSeeds.map((vehicleSeed) => vehicleSeed.tis_org_id))];
}

async function seedVehicles(): Promise<UpsertCounts> {
  const vehicleSeeds = await readSeedJson("vehicles-seed.json", z.array(vehicleSeedSchema));
  const organizationIdByTisOrgId = await getOrganizationIdByTisOrgId();

  const unresolvedTisOrgIds = [
    ...new Set(
      vehicleSeeds
        .map((vehicleSeed) => vehicleSeed.tis_org_id)
        .filter((tisOrgId) => !organizationIdByTisOrgId.has(tisOrgId))
    )
  ];

  if (unresolvedTisOrgIds.length > 0) {
    throw new Error(
      `Cannot resolve organization_id for tis_org_id: ${unresolvedTisOrgIds.join(", ")}`
    );
  }

  let counts: UpsertCounts = { inserted: 0, updated: 0 };

  for (const batch of toBatches(vehicleSeeds, BATCH_SIZE)) {
    const rows = batch.map((vehicleSeed) => ({
      gosNumber: vehicleSeed.gos_number,
      mark: vehicleSeed.mark,
      vehicleType: vehicleSeed.vehicle_type,
      organizationId: organizationIdByTisOrgId.get(vehicleSeed.tis_org_id)!,
      source: "tis",
      tisId: String(vehicleSeed.tis_id)
    }));

    const returnedRows = await db
      .insert(vehicles)
      .values(rows)
      .onConflictDoUpdate({
        target: vehicles.tisId,
        set: {
          gosNumber: sql`excluded.gos_number`,
          mark: sql`excluded.mark`,
          vehicleType: sql`excluded.vehicle_type`,
          organizationId: sql`excluded.organization_id`,
          updatedAt: sql`now()`
        }
      })
      .returning({ inserted: sql<boolean>`xmax = 0` });

    counts = addCounts(counts, countReturnedRows(returnedRows));
  }

  return counts;
}

async function printAtzCandidates(): Promise<void> {
  const atzCandidates = await readSeedJson("atz-candidates.json", z.array(atzCandidateSchema));

  console.log("\nАТЗ не сидятся автоматически: добавить АТЗ вручную через psql.");
  console.table(
    atzCandidates.map((candidate) => ({
      gos_number: candidate.gos_number,
      mark: candidate.mark
    }))
  );
}

async function printFinalCounts(): Promise<void> {
  const [organizationCount] = await db.select({ value: count() }).from(organizations);
  const [vehicleCount] = await db.select({ value: count() }).from(vehicles);

  console.log("\nИтоговые counts:");
  console.log(`organizations=${organizationCount.value}`);
  console.log(`vehicles=${vehicleCount.value}`);
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const organizationCounts = await seedOrganizations();
  console.log(
    `organizations: inserted=${organizationCounts.inserted}, updated=${organizationCounts.updated}`
  );

  const vehicleCounts = await seedVehicles();
  console.log(`vehicles: inserted=${vehicleCounts.inserted}, updated=${vehicleCounts.updated}`);

  await printFinalCounts();
  await printAtzCandidates();
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
