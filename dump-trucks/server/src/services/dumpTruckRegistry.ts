import path from 'path';
import fs from 'fs';

interface RegistryEntry {
  idMo: number;
  regNumber: string | null;
  model: string | null;
  capacity: number | null;  // тоннаж
}

interface Registry {
  vehicles: RegistryEntry[];
}

let _registry: Map<number, RegistryEntry> | null = null;

function loadRegistry(): Map<number, RegistryEntry> {
  const registryPath = path.resolve(__dirname, '../../../config/dump-trucks-registry.json');
  const raw = fs.readFileSync(registryPath, 'utf-8');
  const data: Registry = JSON.parse(raw);
  const map = new Map<number, RegistryEntry>();
  for (const entry of data.vehicles) {
    map.set(entry.idMo, entry);
  }
  return map;
}

export function getRegistry(): Map<number, RegistryEntry> {
  if (!_registry) {
    _registry = loadRegistry();
  }
  return _registry;
}

export function getVehicleInfo(idMO: number): RegistryEntry | null {
  return getRegistry().get(idMO) ?? null;
}

/** Список всех idMO из реестра */
export function getAllIdMos(): number[] {
  return Array.from(getRegistry().keys());
}

/** Capacity (тоннаж) ТС, или null если не задан */
export function getCapacity(idMO: number): number | null {
  return getRegistry().get(idMO)?.capacity ?? null;
}
