import * as fs from 'fs';
import * as path from 'path';

interface RegistryEntry {
  regNumber: string;
  type: string;
  branch: string;
  fuelNorm: number;
}

interface RegistryFile {
  vehicles: RegistryEntry[];
}

const REGISTRY_PATH = path.resolve(__dirname, '../../../config/vehicle-registry.json');
// Реестр правится из админки (раздел «Техника») — перечитываем файл при смене mtime,
// проверяя не чаще раза в 5 с, чтобы рестарт КИП не требовался.
const MTIME_CHECK_MS = 5_000;

let _registry: RegistryFile | null = null;
let _lookupMap: Map<string, RegistryEntry> | null = null;
let _mtimeMs = 0;
let _checkedAt = 0;

function load(): RegistryFile {
  const now = Date.now();
  if (_registry && now - _checkedAt < MTIME_CHECK_MS) return _registry;
  _checkedAt = now;
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(REGISTRY_PATH).mtimeMs; } catch (err) { if (_registry) return _registry; throw err; }
  if (!_registry || mtimeMs !== _mtimeMs) {
    try {
      _registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8')) as RegistryFile;
      _mtimeMs = mtimeMs;
      _lookupMap = null;
    } catch (err) {
      if (!_registry) throw err;
      console.warn('[vehicleRegistry] не удалось перечитать реестр, остаётся прежний:', err);
    }
  }
  return _registry;
}

function getLookupMap(): Map<string, RegistryEntry> {
  const reg = load();
  if (!_lookupMap) {
    _lookupMap = new Map();
    for (const v of reg.vehicles) {
      _lookupMap.set(v.regNumber.toUpperCase(), v);
    }
  }
  return _lookupMap;
}

export function getRegisteredVehicles(): RegistryEntry[] {
  return load().vehicles;
}

export function isRegistered(regNumber: string): boolean {
  return getLookupMap().has(regNumber.toUpperCase());
}

export function getVehicleInfo(regNumber: string): { type: string; branch: string; fuelNorm: number } | null {
  const entry = getLookupMap().get(regNumber.toUpperCase());
  if (!entry) return null;
  return { type: entry.type, branch: entry.branch, fuelNorm: entry.fuelNorm };
}

export function getDistinctTypes(): string[] {
  const types = new Set<string>();
  for (const v of load().vehicles) {
    types.add(v.type);
  }
  return Array.from(types).sort();
}

export function getDistinctBranches(): string[] {
  const branches = new Set<string>();
  for (const v of load().vehicles) {
    branches.add(v.branch);
  }
  return Array.from(branches).sort();
}
