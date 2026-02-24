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

let _registry: RegistryFile | null = null;
let _lookupMap: Map<string, RegistryEntry> | null = null;

function load(): RegistryFile {
  if (!_registry) {
    const filePath = path.resolve(__dirname, '../../../config/vehicle-registry.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    _registry = JSON.parse(raw) as RegistryFile;
  }
  return _registry;
}

function getLookupMap(): Map<string, RegistryEntry> {
  if (!_lookupMap) {
    const reg = load();
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
