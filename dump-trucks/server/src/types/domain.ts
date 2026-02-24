/** Domain types for dump-trucks pipeline */

// Смена
export type ShiftType = 'shift1' | 'shift2';

// Тип работы ТС на объекте
export type WorkType = 'delivery' | 'onsite' | 'unknown';

// Тег зоны (из geo.zone_tags)
export type ZoneTag = 'dt_boundary' | 'dt_loading' | 'dt_unloading';

// ТС из путевого листа
export interface ParsedVehicle {
  idMO: number;
  regNumber: string;
  nameMO: string;
}

// Разобранный путевой лист
export interface ParsedPL {
  plId: number;
  tsNumber: number;
  dateOut: string;         // DD.MM.YYYY
  dateOutPlan: Date;
  dateInPlan: Date;
  status: string;
  vehicles: ParsedVehicle[];
  requestNumbers: number[];
  objectExpendList: string[];
}

// Задание на fetch мониторинга (ТС × смена × объект)
export interface FetchTask {
  idMO: number;
  regNumber: string;
  nameMO: string;
  shiftType: ShiftType;
  shiftStart: Date;
  shiftEnd: Date;
  objectUid: string;
  objectName: string;
  plId?: number;
  requestNumbers: number[];
}

// Зона из geo.zones (загруженная для анализа)
export interface GeoZone {
  uid: string;
  name: string;
  objectUid: string;
  tag: ZoneTag;
  geojson: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
}

// Событие входа/выхода из зоны
export interface ZoneEvent {
  zoneUid: string;
  zoneName: string;
  zoneTag: ZoneTag;
  objectUid: string;
  enteredAt: Date;
  exitedAt: Date | null;
  durationSec: number | null;
}

// Рейс (пара погрузка/выгрузка)
export interface Trip {
  tripNumber: number;
  loadedAt: Date | null;
  unloadedAt: Date | null;
  loadingZone: string | null;
  unloadingZone: string | null;
  durationMin: number | null;
  distanceKm: number | null;
  volumeM3: number | null;
}

// KPI для смены
export interface ShiftKpi {
  engineTimeSec: number;
  movingTimeSec: number;
  distanceKm: number;
  onsiteMin: number;
  tripsCount: number;
  factVolumeM3: number;
  kipPct: number;
  movementPct: number;
  workType: WorkType;
}

// Запись для upsert в shift_records
export interface ShiftRecordInput {
  reportDate: Date;
  shiftType: ShiftType;
  vehicleId: number;
  regNumber: string;
  nameMO: string;
  objectUid: string;
  objectName: string;
  workType: WorkType;
  shiftStart: Date;
  shiftEnd: Date;
  engineTimeSec: number;
  movingTimeSec: number;
  distanceKm: number;
  onsiteMin: number;
  tripsCount: number;
  factVolumeM3: number;
  kipPct: number;
  movementPct: number;
  plId?: number;
  requestNumbers: number[];
  rawMonitoring?: unknown;
  trips: Trip[];
  zoneEvents: ZoneEvent[];
}
