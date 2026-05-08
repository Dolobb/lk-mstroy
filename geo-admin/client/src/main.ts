import * as api from './api.js';
import * as mapModule from './map.js';
import * as sidebar from './sidebar.js';
import type { ZoneInfo } from './sidebar.js';

interface ZoneFeatureProps {
  uid: string;
  name: string;
  object_uid: string;
  tags: string[];
  min_duration_sec: number;
}

let loadedObjects: api.GeoObject[] = [];
let pendingGeometry: GeoJSON.Polygon | null = null;
let currentFilter: 'dst' | 'dt' = 'dst';
let currentOpenObjectUid: string | null = null;
let redrawTargetUid: string | null = null;

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
    sidebar.renderObjectList(loadedObjects.filter(o => visibleObjectUids.has(o.uid)));
  } catch (err) {
    sidebar.showError(`Ошибка загрузки зон: ${(err as Error).message}`);
  }
}

function featureToZoneInfo(f: GeoJSON.Feature): ZoneInfo {
  const p = f.properties as ZoneFeatureProps;
  return {
    uid:            p.uid,
    name:           p.name,
    tags:           p.tags || [],
    minDurationSec: p.min_duration_sec ?? 120,
  };
}

function zoneHandlers(): sidebar.ZoneHandlers {
  return {
    onZoom:         (uid) => mapModule.zoomToZone(uid),
    onDelete:       handleDeleteZone,
    onEdit:         (uid, d) => void showEditZoneModal(uid, d),
    onEditGeometry: (uid) => void startGeometryEdit(uid),
    onRedraw:       (uid) => void startRedraw(uid),
  };
}

async function refreshObjectZones(): Promise<void> {
  if (!currentOpenObjectUid) return;
  const result = await api.getObject(currentOpenObjectUid);
  const zones = result.zones.features.map(featureToZoneInfo);
  sidebar.showObjectZones(currentOpenObjectUid, zones, zoneHandlers());
}

async function showEditZoneModal(uid: string, data: { name: string; tags: string[]; minDurationSec: number }): Promise<void> {
  sidebar.showEditZoneForm(data, async (updated) => {
    try {
      await api.updateZone(uid, { name: updated.name, tags: updated.tags, minDurationSec: updated.minDurationSec });
      await loadZones(currentFilter);
      await refreshObjectZones();
    } catch (err) {
      sidebar.showError(`Ошибка обновления зоны: ${(err as Error).message}`);
    }
  });
}

// ── Geometry editing (vertex drag) ────────────────────────────────────────
function showEditControls(): void {
  removeEditControls();
  const bar = document.createElement('div');
  bar.id = 'edit-controls';
  bar.className = 'edit-controls';
  bar.innerHTML = `
    <span>Редактирование геометрии</span>
    <button id="edit-save" class="btn-primary">Сохранить</button>
    <button id="edit-cancel" class="btn-cancel">Отмена</button>
  `;
  document.body.appendChild(bar);
}

function removeEditControls(): void {
  document.getElementById('edit-controls')?.remove();
}

async function startGeometryEdit(uid: string): Promise<void> {
  mapModule.zoomToZone(uid);
  mapModule.startEditZone(uid);
  showEditControls();

  document.getElementById('edit-save')?.addEventListener('click', async () => {
    const geometry = mapModule.stopEditZone();
    removeEditControls();
    if (!geometry) return;
    try {
      await api.updateZone(uid, { geometry });
      await loadZones(currentFilter);
      await refreshObjectZones();
    } catch (err) {
      sidebar.showError(`Ошибка сохранения геометрии: ${(err as Error).message}`);
    }
  });

  document.getElementById('edit-cancel')?.addEventListener('click', () => {
    mapModule.cancelEditZone();
    removeEditControls();
  });
}

// ── Redraw polygon from scratch ──────────────────────────────────────────
async function startRedraw(uid: string): Promise<void> {
  if (!confirm('Перерисовать полигон? Текущая геометрия будет заменена.')) return;
  redrawTargetUid = uid;
  mapModule.activateLeafletDraw();
}

async function init(): Promise<void> {
  const map = mapModule.initMap();

  sidebar.initSidebar({
    onObjectSelect: async (uid) => {
      currentOpenObjectUid = uid;
      try {
        const result = await api.getObject(uid);
        const zones = result.zones.features.map(featureToZoneInfo);
        sidebar.showObjectZones(uid, zones, zoneHandlers());
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
    onObjectEdit: (obj) => {
      sidebar.showEditObjectForm(
        { name: obj.name, minTripsPerShift: obj.min_trips_per_shift ?? 0 },
        async (updated) => {
          try {
            const saved = await api.updateObject(obj.uid, updated);
            const idx = loadedObjects.findIndex(o => o.uid === obj.uid);
            if (idx !== -1) {
              loadedObjects[idx] = { ...loadedObjects[idx], ...saved };
            }
            sidebar.renderObjectList(loadedObjects);
          } catch (err) {
            sidebar.showError(`Ошибка обновления объекта: ${(err as Error).message}`);
          }
        },
      );
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

  // Нажатие Escape — отмена рисования / отмена edit
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (mapModule.isEditing()) {
        mapModule.cancelEditZone();
        removeEditControls();
      } else {
        mapModule.deactivateLeafletDraw();
        redrawTargetUid = null;
      }
    }
  });

  // Событие: полигон нарисован
  map.on('draw:created', async (e: any) => {
    const geometry = e.layer.toGeoJSON().geometry as GeoJSON.Polygon;
    mapModule.deactivateLeafletDraw();

    // Redraw existing zone
    if (redrawTargetUid) {
      const uid = redrawTargetUid;
      redrawTargetUid = null;
      try {
        await api.updateZone(uid, { geometry });
        await loadZones(currentFilter);
        await refreshObjectZones();
      } catch (err) {
        sidebar.showError(`Ошибка перерисовки зоны: ${(err as Error).message}`);
      }
      return;
    }

    // New zone
    pendingGeometry = geometry;
    sidebar.showNewZoneForm(loadedObjects, async (data) => {
      if (!pendingGeometry) return;
      try {
        const zone = await api.createZone({
          objectUid: data.objectUid,
          name:      data.name,
          tags:      data.tags,
          geometry:  pendingGeometry,
          minDurationSec: data.minDurationSec,
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
