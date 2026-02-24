const BASE = '/api/geo';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string };
    throw new Error(err.error || res.statusText);
  }
  return res.json() as Promise<T>;
}

// ── Types ────────────────────────────────────────────────────────────────────
export interface GeoObject {
  id: number;
  uid: string;
  name: string;
  smu: string | null;
  region: string | null;
  zone_count?: number;
}

export interface GeoZone {
  id: number;
  uid: string;
  object_id: number;
  name: string;
  tags: string[];
  geometry: GeoJSON.Polygon;
}

export interface ObjectWithZones {
  object: GeoObject;
  zones: GeoJSON.FeatureCollection;
}

// ── Objects ──────────────────────────────────────────────────────────────────
export const getObjects = (): Promise<GeoObject[]> =>
  request('GET', '/objects');

export const getObject = (uid: string): Promise<ObjectWithZones> =>
  request('GET', `/objects/${uid}`);

export const createObject = (data: { name: string; smu?: string; region?: string }): Promise<GeoObject> =>
  request('POST', '/objects', data);

export const updateObject = (uid: string, data: { name?: string; smu?: string | null; region?: string | null }): Promise<GeoObject> =>
  request('PUT', `/objects/${uid}`, data);

export const deleteObject = (uid: string): Promise<{ deleted: boolean; uid: string }> =>
  request('DELETE', `/objects/${uid}`);

// ── Zones ────────────────────────────────────────────────────────────────────
export const createZone = (data: {
  objectUid: string; name: string; tags: string[]; geometry: GeoJSON.Polygon;
}): Promise<GeoZone> => request('POST', '/zones', data);

export const updateZone = (uid: string, data: {
  name?: string; tags?: string[]; geometry?: GeoJSON.Polygon;
}): Promise<GeoZone> => request('PUT', `/zones/${uid}`, data);

export const deleteZone = (uid: string): Promise<{ deleted: boolean; uid: string }> =>
  request('DELETE', `/zones/${uid}`);

export const getZonesByObject = (objectUid: string, tags?: string[]): Promise<GeoJSON.FeatureCollection> => {
  const qs = tags && tags.length ? `?tags=${tags.join(',')}` : '';
  return request('GET', `/zones/by-object/${objectUid}${qs}`);
};

export const getZonesByTag = (tag: string): Promise<GeoJSON.FeatureCollection> =>
  request('GET', `/zones/by-tag/${tag}`);
