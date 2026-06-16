/**
 * B7: отчёт по неопознанным организациям приложения выдачи топлива.
 *
 * Орг с `name: null` в organizations-seed.json приложение показывает как «TIS-организация {tis_org_id}»
 * (seed.ts:82). Чтобы их опознать — на каждую даём примеры машин (госномер + модель) из getPassports.
 * Юзер по номерам/моделям уточняет реальное название организации.
 *
 * Запуск:  node fuel-backend/seed-scripts/unidentified-orgs-report.mjs [N]
 *          N — сколько примеров на орг (по умолчанию 3).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const seedDir = join(here, "..", "seed");
const EXAMPLES = Number(process.argv[2] ?? 3);

const orgs = JSON.parse(readFileSync(join(seedDir, "organizations-seed.json"), "utf8"));
const passports = JSON.parse(readFileSync(join(seedDir, "getpassports-sample.json"), "utf8")).passports;

// Паспорты, сгруппированные по организации (числовой tis-id).
const byOrg = new Map();
for (const p of passports) {
  if (!byOrg.has(p.organization)) byOrg.set(p.organization, []);
  byOrg.get(p.organization).push(p);
}

const unidentified = orgs
  .filter((o) => o.name === null)
  .sort((a, b) => b.vehicle_count - a.vehicle_count);

console.log(`\nНеопознанных организаций: ${unidentified.length} (показываю как «TIS-организация {id}»)`);
console.log(`Примеров машин на орг: до ${EXAMPLES} (из getPassports)\n`);
console.log("=".repeat(78));

for (const org of unidentified) {
  const fleet = (byOrg.get(org.tis_org_id) ?? []).slice();
  // Сначала зарегистрированные и с «человеческим» госномером (буквы) — их легче опознать.
  fleet.sort((a, b) => {
    const aPlate = /[А-Яа-яA-Za-z]/.test(a.regNumber) ? 0 : 1;
    const bPlate = /[А-Яа-яA-Za-z]/.test(b.regNumber) ? 0 : 1;
    if (aPlate !== bPlate) return aPlate - bPlate;
    return Number(b.registered) - Number(a.registered);
  });
  const examples = fleet.slice(0, EXAMPLES);

  console.log(`\nTIS-организация ${org.tis_org_id}   (машин в парке: ${org.vehicle_count})`);
  if (examples.length === 0) {
    console.log("   (в getPassports машин не найдено)");
    continue;
  }
  for (const p of examples) {
    const reg = String(p.regNumber || "—").padEnd(14);
    const model = p.modelOrMarkOrModif || "—";
    const flag = p.registered ? "" : "  [не registered]";
    console.log(`   ${reg} ${model}${flag}`);
  }
}
console.log("\n" + "=".repeat(78));
