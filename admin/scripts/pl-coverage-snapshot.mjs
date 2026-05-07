#!/usr/bin/env node
// Snapshot/diff покрытия ПЛ за целевую дату.
//
// Usage:
//   node admin/scripts/pl-coverage-snapshot.mjs snapshot 2026-05-06
//   node admin/scripts/pl-coverage-snapshot.mjs diff 2026-05-06
//
// snapshot — сохраняет JSON в admin/scripts/_snapshots/<date>__<timestamp>.json
// diff     — сравнивает два последних снапшота для даты, печатает добавленные/удалённые ПЛ
//            и для добавленных — их date_out_plan / created_at (когда появились в БД).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAP_DIR = path.join(__dirname, '_snapshots');
fs.mkdirSync(SNAP_DIR, { recursive: true });

const REG_PATH = path.resolve(__dirname, '../../kip/config/vehicle-registry.json');
const registry = new Set(
  JSON.parse(fs.readFileSync(REG_PATH, 'utf8')).vehicles.map((v) => v.regNumber.toUpperCase()),
);

const pool = new pg.Pool({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: '888',
  database: 'kip_vehicles',
});

const [, , cmd, dateArg] = process.argv;
if (!cmd || !dateArg || !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
  console.error('Usage: node pl-coverage-snapshot.mjs <snapshot|diff> YYYY-MM-DD');
  process.exit(1);
}

async function takeSnapshot(date) {
  const { rows } = await pool.query(
    `SELECT rl.pl_id,
            rl.date_out_plan,
            rl.date_in_plan,
            rl.status,
            rl.created_at,
            COALESCE(json_agg(DISTINCT UPPER(v.reg_number)) FILTER (WHERE v.reg_number IS NOT NULL), '[]') AS regs
       FROM route_lists rl
  LEFT JOIN vehicles v ON v.route_list_id = rl.id
      WHERE rl.date_out_plan::date <= $1::date
        AND rl.date_in_plan::date  >= $1::date
   GROUP BY rl.pl_id, rl.date_out_plan, rl.date_in_plan, rl.status, rl.created_at
   ORDER BY rl.pl_id`,
    [date],
  );

  const regsAll = new Set();
  const regsInRegistry = new Set();
  for (const r of rows) {
    for (const reg of r.regs) {
      regsAll.add(reg);
      if (registry.has(reg)) regsInRegistry.add(reg);
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(SNAP_DIR, `${date}__${stamp}.json`);
  const snap = {
    target_date: date,
    snapshot_at: new Date().toISOString(),
    totals: {
      pls: rows.length,
      distinct_regs_total: regsAll.size,
      distinct_regs_in_registry: regsInRegistry.size,
    },
    regs_in_registry: [...regsInRegistry].sort(),
    pls: rows.map((r) => ({
      pl_id: String(r.pl_id),
      date_out_plan: r.date_out_plan,
      date_in_plan: r.date_in_plan,
      status: r.status,
      created_at: r.created_at,
      regs: r.regs,
      regs_in_registry: r.regs.filter((x) => registry.has(x)),
    })),
  };
  fs.writeFileSync(file, JSON.stringify(snap, null, 2));
  console.log(`Snapshot → ${path.relative(process.cwd(), file)}`);
  console.log(`  PLs covering ${date}: ${snap.totals.pls}`);
  console.log(`  Distinct regs in PL: ${snap.totals.distinct_regs_total}`);
  console.log(`  …of which in registry: ${snap.totals.distinct_regs_in_registry}`);
}

async function diffSnapshots(date) {
  const files = fs
    .readdirSync(SNAP_DIR)
    .filter((f) => f.startsWith(date + '__') && f.endsWith('.json'))
    .sort();
  if (files.length < 2) {
    console.error(`Need ≥2 snapshots for ${date}, found ${files.length}.`);
    process.exit(1);
  }
  const oldSnap = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, files[0]), 'utf8'));
  const newSnap = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, files[files.length - 1]), 'utf8'));
  console.log(`OLD: ${files[0]} (${oldSnap.snapshot_at})`);
  console.log(`NEW: ${files[files.length - 1]} (${newSnap.snapshot_at})`);

  const oldIds = new Map(oldSnap.pls.map((p) => [p.pl_id, p]));
  const newIds = new Map(newSnap.pls.map((p) => [p.pl_id, p]));

  const added = [...newIds.keys()].filter((id) => !oldIds.has(id));
  const removed = [...oldIds.keys()].filter((id) => !newIds.has(id));

  console.log(`\nPL counts: old=${oldSnap.totals.pls} → new=${newSnap.totals.pls} (Δ ${newSnap.totals.pls - oldSnap.totals.pls})`);
  console.log(`Regs in registry: old=${oldSnap.totals.distinct_regs_in_registry} → new=${newSnap.totals.distinct_regs_in_registry}`);
  console.log(`\n+++ ADDED PLs (${added.length}):`);
  for (const id of added) {
    const p = newIds.get(id);
    const inReg = p.regs_in_registry.join(',') || '—';
    console.log(`  pl_id=${id}  out=${p.date_out_plan}  in=${p.date_in_plan}  created_in_db=${p.created_at}  status=${p.status}  registry_regs=[${inReg}]`);
  }
  console.log(`\n--- REMOVED PLs (${removed.length}):`);
  for (const id of removed) {
    const p = oldIds.get(id);
    console.log(`  pl_id=${id}  out=${p.date_out_plan}  in=${p.date_in_plan}  status=${p.status}`);
  }

  const oldRegs = new Set(oldSnap.regs_in_registry);
  const newRegs = new Set(newSnap.regs_in_registry);
  const newlyAppeared = [...newRegs].filter((r) => !oldRegs.has(r)).sort();
  const disappeared = [...oldRegs].filter((r) => !newRegs.has(r)).sort();
  console.log(`\nRegistry regs newly covering ${date} (${newlyAppeared.length}): ${newlyAppeared.join(', ') || '—'}`);
  console.log(`Registry regs no longer covering ${date} (${disappeared.length}): ${disappeared.join(', ') || '—'}`);
}

try {
  if (cmd === 'snapshot') await takeSnapshot(dateArg);
  else if (cmd === 'diff') await diffSnapshots(dateArg);
  else {
    console.error('Unknown command:', cmd);
    process.exit(1);
  }
} finally {
  await pool.end();
}
