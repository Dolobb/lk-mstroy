import * as api from './api.js';
import * as mapModule from './map.js';
import * as sidebar from './sidebar.js';

let loadedObjects: api.GeoObject[] = [];
let pendingGeometry: GeoJSON.Polygon | null = null;
let currentFilter: 'dst' | 'dt' = 'dst';

async function loadZones(filter: 'dst' | 'dt'): Promise<void> {
  mapModule.clearAllZones();
  const tags = filter === 'dst'
    ? ['dst_zone', 'dt_boundary']
    : ['dt_loading', 'dt_unloading', 'dt_boundary'];

  try {
    const results = await Promise.all(tags.map(t => api.getZonesByTag(t)));
    const seen = new Set<string>();
    for (const fc of results) {
      for (const feature of fc.features) {
        const uid = (feature.properties as { uid: string }).uid;
        if (!seen.has(uid)) {
          seen.add(uid);
          mapModule.addZoneToMap(feature, handleDeleteZone);
        }
      }
    }
  } catch (err) {
    sidebar.showError(`Ошибка загрузки зон: ${(err as Error).message}`);
  }
}

async function init(): Promise<void> {
  const map = mapModule.initMap();

  sidebar.initSidebar({
    onObjectSelect: async (uid) => {
      const result = await api.getObject(uid);
      const names = result.zones.features.map(
        f => (f.properties as { name: string }).name,
      );
      sidebar.showObjectZones(uid, names);
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
