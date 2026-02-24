import * as api from './api.js';
import * as mapModule from './map.js';
import * as sidebar from './sidebar.js';

let loadedObjects: api.GeoObject[] = [];
let pendingGeometry: GeoJSON.Polygon | null = null;

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

  // Загрузить объекты и все зоны одним запросом
  try {
    [loadedObjects] = await Promise.all([api.getObjects()]);
    sidebar.renderObjectList(loadedObjects);

    // Все зоны за один запрос по тегу dst_zone
    const allZones = await api.getZonesByTag('dst_zone');
    for (const feature of allZones.features) {
      mapModule.addZoneToMap(feature, handleDeleteZone);
    }
  } catch (err) {
    sidebar.showError(`Ошибка загрузки данных: ${(err as Error).message}`);
  }

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
