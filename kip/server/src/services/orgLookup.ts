import fs from 'fs';
import path from 'path';

interface OrgEntry {
  orgId: string;
  orgName: string;
  idMOs: number[];
}

let cache: Map<number, string> | null = null;

function loadLookup(): Map<number, string> {
  if (cache) return cache;

  const filePath = path.resolve(__dirname, '../../../../config/vehicle-organizations.json');
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const orgs: OrgEntry[] = JSON.parse(raw);
    cache = new Map();
    for (const org of orgs) {
      for (const idMO of org.idMOs) {
        cache.set(idMO, org.orgName);
      }
    }
  } catch {
    console.warn('[orgLookup] Failed to load vehicle-organizations.json, org lookup disabled');
    cache = new Map();
  }

  return cache;
}

export function getOrgByIdMO(idMO: number): string | null {
  return loadLookup().get(idMO) ?? null;
}
