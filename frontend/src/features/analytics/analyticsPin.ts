import L from 'leaflet';
import type { UnifiedVehicleRow } from './types';

function getVehicleIconUrl(row: UnifiedVehicleRow): string {
  if (row.source === 'dump_truck') return '/vehicle-icons/dump-truck.svg';
  const t = row.vehicleType;
  if (!t) return '';
  if (t === 'Бульдозер') return '/vehicle-icons/bulldozer.svg';
  if (t.startsWith('Каток')) return '/vehicle-icons/roller.svg';
  if (t.startsWith('Краны автомобильные')) return '/vehicle-icons/crane-truck.svg';
  if (t.startsWith('Краны гусеничные')) return '/vehicle-icons/crane-crawler.svg';
  if (t.startsWith('Краны пневмоколёсные') || t.startsWith('Краны пневмоколесные')) return '/vehicle-icons/crane-pneumo.svg';
  if (t === 'Погрузчик') return '/vehicle-icons/loader.svg';
  if (t === 'Экскаватор гусеничный') return '/vehicle-icons/excavator-crawler.svg';
  if (t === 'Экскаватор колесный') return '/vehicle-icons/excavator-wheel.svg';
  if (t === 'Экскаватор-погрузчик') return '/vehicle-icons/excavator-loader.svg';
  return '';
}

function kipClass(kip: number): string {
  if (kip <= 0) return 'kip-na';
  if (kip < 50) return 'kip-red';
  if (kip < 75) return 'kip-blue';
  return 'kip-green';
}

const ICON_W = 140;
const ICON_H = 60;

export function createAnalyticsPin(row: UnifiedVehicleRow, isSelected = false): L.DivIcon {
  const kip = Math.round(row.avgKipPct);
  const cls = kipClass(kip);
  const iconUrl = getVehicleIconUrl(row);
  const iconHtml = iconUrl ? `<img src="${iconUrl}" class="apin-icon-img" alt="" />` : '';
  const sel = isSelected ? ' selected' : '';
  const kipStr = kip > 0 ? `${kip}%` : 'Н/Д';

  const html = `
    <div class="apin ${cls}${sel}">
      <div class="apin-compact">
        <div class="apin-icon">${iconHtml}</div>
        <div class="apin-plate">${row.regNumber}</div>
        <div class="apin-expand"><div class="apin-sep"></div><span class="apin-kip${kip <= 0 ? ' no-data' : ''}">${kipStr}</span></div>
      </div>
      <div class="apin-stem"></div><div class="apin-dot"></div>
    </div>
  `;

  return L.divIcon({
    className: '',
    html,
    iconSize: [ICON_W, ICON_H],
    iconAnchor: [ICON_W / 2, ICON_H],
    popupAnchor: [0, -ICON_H],
  });
}
