import * as api from './api.js';
import * as mapModule from './map.js';
import * as sidebar from './sidebar.js';
import type { ZoneInfo } from './sidebar.js';

interface ZoneFeatureProps {
  uid: string;
  name: string;
  object_uid: string;
  tags: string[];
}

let loadedObjects: api.GeoObject[] = [];
let pendingGeometry: GeoJSON.Polygon | null = null;
let currentFilter: 'dst' | 'dt' = 'dst';
let currentOpenObjectUid: string | null = null;

async function loadZones(filter: 'dst' | 'dt'): Promise<void> {
  mapModule.clearAllZones();
  const tags = filter === 'dst'
    ? ['dst_zone', 'dt_boundary']
    : ['dt_loading', 'dt_unloading', 'dt_boundary'];

  try {
    const visibleObjectUids = new Set<string>();
    const seen = new Set<string>();
    const results = await Promise.all(tags.map(t => api.getZonesByTag(t)));
    for (const fc of results) {
      for (const feature of fc.features) {
        const props = feature.properties as ZoneFeatureProps;
        if (props.object_uid) visibleObjectUids.add(props.object_uid);
        if (!seen.has(props.uid)) {
          seen.add(props.uid);
          mapModule.addZoneToMap(feature, handleDeleteZone);
        }
      }
    }
    const filtered = visibleObjectUids.size > 0
      ? loadedObjects.filter(o => visibleObjectUids.has(o.uid))
      : loadedObjects;
    sidebar.renderObjectList(filtered);
  } catch (err) {
    sidebar.showError(`Ошибка загрузки зон: ${(err as Error).message}`);
  }
}

async function showEditZoneModal(uid: string, data: { name: string; tags: string[] }): Promise<void> {
  sidebar.showEditZoneForm(data, async (updated) => {
    try {
      await api.updateZone(uid, updated);
      await loadZones(currentFilter);
      if (currentOpenObjectUid) {
        const result = await api.getObject(currentOpenObjectUid);
        const zones: ZoneInfo[] = result.zones.features.map(f => ({
          uid:  (f.properties as ZoneFeatureProps).uid,
          name: (f.properties as ZoneFeatureProps).name,
          tags: (f.properties as ZoneFeatureProps).tags || [],
        }));
        sidebar.showObjectZones(currentOpenObjectUid, zones, {
          onZoom:   (zoneUid) => mapModule.zoomToZone(zoneUid),
          onDelete: handleDeleteZone,
          onEdit:   (zoneUid, d) => void showEditZoneModal(zoneUid, d),
        });
      }
    } catch (err) {
      sidebar.showError(`Ошибка обновления зоны: ${(err as Error).message}`);
    }
  });
}

async function init(): Promise<void> {
  const map = mapModule.initMap();

  sidebar.initSidebar({
    onObjectSelect: async (uid) => {
      currentOpenObjectUid = uid;
      try {
        const result = await api.getObject(uid);
        const zones: ZoneInfo[] = result.zones.features.map(f => ({
          uid:  (f.properties as ZoneFeatureProps).uid,
          name: (f.properties as ZoneFeatureProps).name,
          tags: (f.properties as ZoneFeatureProps).tags || [],
        }));
        sidebar.showObjectZones(uid, zones, {
          onZoom:   (zoneUid) => mapModule.zoomToZone(zoneUid),
          onDelete: handleDeleteZone,
          onEdit:   (zoneUid, data) => void showEditZoneModal(zoneUid, data),
        });
        // Зум на boundary или первую зону объекта
        const boundary = result.zones.features.find(f =>
          ((f.properties as ZoneFeatureProps).tags || []).includes('dt_boundary'),
        ) ?? result.zones.features[0];
        if (boundary) mapModule.zoomToFeature(boundary);
      } catch (err) {
        sidebar.showError(`Ошибка загрузки объекта: ${(err as Error).message}`);
      }
    },
    onNewObject: () => {
      sidebar.showNewObjectForm(async (data) => {
        try {
          const obj = await api.createObject(data);
          loadedObjects.push(obj);
          sidebar.renderObjectList(loadedObjects);
        } catch (err) {
          sidebar.showError(`Ошибка создания объекта: ${(err as Error).message}`);
        }
      });
    },
  });

  // Загрузить объекты
  try {
    loadedObjects = await api.getObjects();
    sidebar.renderObjectList(loadedObjects);
  } catch (err) {
    sidebar.showError(`Ошибка загрузки объектов: ${(err as Error).message}`);
  }

  // Загрузить зоны по текущему фильтру
  await loadZones(currentFilter);

  // Переключатель фильтра
  document.querySelectorAll<HTMLButtonElement>('.filter-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter as 'dst' | 'dt';
      await loadZones(currentFilter);
    });
  });

  // Кнопка "Нарисовать зону"
  document.getElementById('btn-draw-zone')?.addEventListener('click', () => {
    mapModule.activateLeafletDraw();
  });

  // Нажатие Escape — отмена рисования
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') mapModule.deactivateLeafletDraw();
  });

  // Событие: полигон нарисован
  map.on('draw:created', (e: any) => {
    pendingGeometry = e.layer.toGeoJSON().geometry as GeoJSON.Polygon;
    mapModule.deactivateLeafletDraw();

    sidebar.showNewZoneForm(loadedObjects, async (data) => {
      if (!pendingGeometry) return;
      try {
        const zone = await api.createZone({
          objectUid: data.objectUid,
          name:      data.name,
          tags:      data.tags,
          geometry:  pendingGeometry,
        });
        mapModule.addZoneFromModel(zone, handleDeleteZone);
        pendingGeometry = null;

        const idx = loadedObjects.findIndex(o => o.uid === data.objectUid);
        if (idx !== -1) {
          loadedObjects[idx].zone_count = (loadedObjects[idx].zone_count ?? 0) + 1;
        }
        sidebar.renderObjectList(loadedObjects);
      } catch (err) {
        sidebar.showError(`Ошибка создания зоны: ${(err as Error).message}`);
      }
    });
  });
}

async function handleDeleteZone(uid: string): Promise<void> {
  if (!confirm('Удалить зону?')) return;
  try {
    await api.deleteZone(uid);
    mapModule.removeZoneFromMap(uid);
  } catch (err) {
    sidebar.showError(`Ошибка удаления: ${(err as Error).message}`);
  }
}

// Ждём DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void init());
} else {
  void init();
}
