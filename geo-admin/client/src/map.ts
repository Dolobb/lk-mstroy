/* eslint-disable @typescript-eslint/no-explicit-any */
import type { GeoZone } from './api.js';

// L and Leaflet.draw are loaded from CDN
declare const L: any;

const TAG_COLORS: Record<string, { color: string; fillOpacity: number }> = {
  dt_boundary:  { color: '#888888', fillOpacity: 0.10 },
  dt_loading:   { color: '#2e7d32', fillOpacity: 0.30 },
  dt_unloading: { color: '#e65100', fillOpacity: 0.30 },
  dt_onsite:    { color: '#1565c0', fillOpacity: 0.25 },
  dst_zone:     { color: '#6a1b9a', fillOpacity: 0.20 },
};

const TAG_PRIORITY = ['dt_boundary', 'dt_loading', 'dt_unloading', 'dt_onsite', 'dst_zone'];
const DEFAULT_STYLE = { color: '#555555', fillOpacity: 0.20 };

export function colorByTags(tags: string[]): { color: string; fillOpacity: number } {
  for (const tag of TAG_PRIORITY) {
    if (tags.includes(tag)) return TAG_COLORS[tag];
  }
  return DEFAULT_STYLE;
}

let map: any;
let drawnLayer: any;
let activeDrawHandler: any = null;
const zoneLayerMap = new Map<string, any>();

export function initMap(): any {
  map = L.map('map').setView([57.15, 65.55], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);

  drawnLayer = new L.FeatureGroup();
  drawnLayer.addTo(map);

  return map;
}

export function getMap(): any { return map; }

export function activateLeafletDraw(): void {
  if (activeDrawHandler) {
    activeDrawHandler.disable();
    activeDrawHandler = null;
  }
  activeDrawHandler = new L.Draw.Polygon(map, {
    allowIntersection: false,
    showArea: true,
    shapeOptions: { color: '#3388ff', weight: 2 },
    guidelineDistance: 20,
  });
  activeDrawHandler.enable();
  // Визуально показать что режим активен
  const btn = document.getElementById('btn-draw-zone');
  if (btn) btn.style.outline = '2px solid #3388ff';
}

export function deactivateLeafletDraw(): void {
  if (activeDrawHandler) {
    activeDrawHandler.disable();
    activeDrawHandler = null;
  }
  drawnLayer.clearLayers();
  const btn = document.getElementById('btn-draw-zone');
  if (btn) btn.style.outline = '';
}

export function addZoneToMap(
  feature: GeoJSON.Feature,
  onClickDelete?: (uid: string) => void,
): void {
  const props = feature.properties as { uid: string; name: string; tags: string[] };
  if (!feature.geometry || feature.geometry.type !== 'Polygon') return;

  const style = colorByTags(props.tags || []);
  const coords = (feature.geometry as GeoJSON.Polygon).coordinates[0];
  const latLngs = coords.map(([lng, lat]) => L.latLng(lat, lng));

  const polygon = L.polygon(latLngs, {
    color:       style.color,
    weight:      2,
    fillColor:   style.color,
    fillOpacity: style.fillOpacity,
  });

  const tagLabels = (props.tags || []).join(', ') || '—';
  const popupHtml = `
    <div style="min-width:180px">
      <strong>${escapeHtml(props.name)}</strong><br>
      <small style="color:#666">Теги: ${escapeHtml(tagLabels)}</small><br>
      <div style="margin-top:6px">
        <button
          onclick="window.__geoAdminDeleteZone('${props.uid}')"
          style="background:#dc2626;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px"
        >Удалить</button>
      </div>
    </div>`;

  polygon.bindPopup(popupHtml);
  polygon.addTo(map);
  zoneLayerMap.set(props.uid, polygon);

  if (onClickDelete) {
    (window as any)['__geoAdminDeleteZone'] = (uid: string) => {
      onClickDelete(uid);
    };
  }
}

export function removeZoneFromMap(uid: string): void {
  const layer = zoneLayerMap.get(uid);
  if (layer) {
    map.removeLayer(layer);
    zoneLayerMap.delete(uid);
  }
}

export function addZoneFromModel(zone: GeoZone, onDelete?: (uid: string) => void): void {
  addZoneToMap(
    {
      type: 'Feature',
      properties: { uid: zone.uid, name: zone.name, tags: zone.tags },
      geometry:   zone.geometry,
    },
    onDelete,
  );
}

export function clearAllZones(): void {
  zoneLayerMap.forEach((layer: any) => map.removeLayer(layer));
  zoneLayerMap.clear();
}

export function zoomToZone(uid: string): void {
  const layer = zoneLayerMap.get(uid);
  if (layer) map.fitBounds(layer.getBounds(), { padding: [40, 40] });
}

export function zoomToFeature(feature: GeoJSON.Feature): void {
  const coords = (feature.geometry as GeoJSON.Polygon).coordinates[0];
  const bounds = L.latLngBounds(coords.map((pos: number[]) => L.latLng(pos[1], pos[0])));
  map.fitBounds(bounds, { padding: [40, 40] });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
