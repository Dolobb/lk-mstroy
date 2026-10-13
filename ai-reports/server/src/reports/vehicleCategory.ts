// ─── Категории техники для отчётов (как в «Отчёте ОТТУ» / фильтрах «КИП техники») ──
// Источник истины по типу ТС — kip/config/vehicle-registry.json (поле `type`).
// В реестре тип содержит подгруппу по грузоподъёмности («, г/п 100») — для группировки
// отчёта она ИГНОРИРУЕТСЯ: группируем по базовой категории (Краны автомобильные и т.п.),
// а не по модели и не по г/п. См. «список неточностей» п.6.

import * as fs from 'fs';
import * as path from 'path';

interface RegistryEntry { regNumber: string; type: string; branch: string; fuelNorm: number; }
interface RegistryFile { vehicles: RegistryEntry[]; }

const REGISTRY_PATH = path.resolve(
  __dirname,
  '../../../../kip/config/vehicle-registry.json',
);

let _lookup: Map<string, string> | null = null;

/** Убирает подгруппу по грузоподъёмности: «Краны автомобильные, г/п 100» → «Краны автомобильные». */
export function stripCapacity(type: string): string {
  return type.replace(/,\s*г\/п.*$/i, '').trim();
}

function loadLookup(): Map<string, string> {
  if (_lookup) return _lookup;
  const map = new Map<string, string>();
  try {
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf-8');
    const reg = JSON.parse(raw) as RegistryFile;
    for (const v of reg.vehicles) {
      map.set(v.regNumber.toUpperCase(), stripCapacity(v.type));
    }
  } catch (err) {
    console.warn('[reports] vehicle-registry.json недоступен:', err);
  }
  _lookup = map;
  return map;
}

/** Базовая категория ТС по госномеру (без г/п). '' если нет в реестре. */
export function categoryForReg(regNumber: string): string {
  return loadLookup().get((regNumber || '').toUpperCase()) ?? '';
}

const OTHER = 'Прочие';

// Базовая категория реестра → подпись группы в отчёте (множественное число, как в ОТТУ).
const CATEGORY_LABEL: Record<string, string> = {
  'Бульдозер': 'Бульдозеры',
  'Краны автомобильные': 'Краны автомобильные',
  'Краны гусеничные': 'Краны гусеничные',
  'Краны пневмоколёсные': 'Краны пневмоколёсные',
  'Экскаватор гусеничный': 'Экскаваторы гусеничные',
  'Экскаватор колесный': 'Экскаваторы колёсные',
  'Экскаватор-погрузчик': 'Экскаваторы-погрузчики',
  'Погрузчик': 'Погрузчики',
  'Каток грунтовый': 'Катки грунтовые',
  'Каток асфальтный': 'Катки асфальтные',
};

// Порядок групп в отчёте (как в ОТТУ; остальные — после, по алфавиту, «Прочие» в конце).
const CATEGORY_ORDER: string[] = [
  'Бульдозер',
  'Краны автомобильные',
  'Краны гусеничные',
  'Краны пневмоколёсные',
  'Экскаватор гусеничный',
  'Экскаватор колесный',
  'Экскаватор-погрузчик',
  'Погрузчик',
  'Каток грунтовый',
  'Каток асфальтный',
];

/** Нормализованный ключ категории (для группировки). Пустую → «Прочие». */
export function categoryKey(baseType: string): string {
  return baseType && baseType.trim() ? baseType.trim() : OTHER;
}

/** Подпись группы для шапки «Тип …». */
export function categoryLabel(key: string): string {
  return CATEGORY_LABEL[key] ?? key;
}

/** Индекс сортировки группы (известные — по ОТТУ, остальные — в хвост, «Прочие» последними). */
export function categoryOrderIndex(key: string): number {
  const i = CATEGORY_ORDER.indexOf(key);
  if (i !== -1) return i;
  if (key === OTHER) return CATEGORY_ORDER.length + 1;
  return CATEGORY_ORDER.length; // прочие известные-но-не-в-списке между ОТТУ и «Прочие»
}
