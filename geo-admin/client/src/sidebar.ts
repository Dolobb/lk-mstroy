import type { GeoObject } from './api.js';

let onObjectSelect: ((uid: string) => void) | null = null;
let onNewObject: (() => void) | null = null;

export function initSidebar(handlers: {
  onObjectSelect: (uid: string) => void;
  onNewObject: () => void;
}): void {
  onObjectSelect = handlers.onObjectSelect;
  onNewObject = handlers.onNewObject;

  document.getElementById('btn-new-object')?.addEventListener('click', () => {
    handlers.onNewObject();
  });
}

export function renderObjectList(objects: GeoObject[]): void {
  const list = document.getElementById('object-list');
  if (!list) return;

  list.innerHTML = '';

  if (objects.length === 0) {
    list.innerHTML = '<div class="empty-state">Объекты не найдены</div>';
    return;
  }

  for (const obj of objects) {
    const item = document.createElement('div');
    item.className = 'object-item';
    item.dataset.uid = obj.uid;
    item.innerHTML = `
      <div class="object-header">
        <span class="object-arrow">▶</span>
        <span class="object-name">${escapeHtml(obj.name)}</span>
        <span class="zone-count" title="Зоны">${obj.zone_count ?? 0}</span>
      </div>
      ${obj.smu ? `<div class="object-smu">${escapeHtml(obj.smu)}</div>` : ''}
    `;

    item.querySelector('.object-header')?.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');
      document.querySelectorAll('.object-item.open').forEach(el => el.classList.remove('open'));
      if (!isOpen) {
        item.classList.add('open');
        onObjectSelect?.(obj.uid);
      }
    });

    list.appendChild(item);
  }
}

export interface ZoneInfo { uid: string; name: string; tags: string[]; }
export interface ZoneHandlers {
  onZoom:   (uid: string) => void;
  onDelete: (uid: string) => Promise<void>;
  onEdit:   (uid: string, data: { name: string; tags: string[] }) => void;
}

const TAG_BADGE_CLASS: Record<string, string> = {
  dt_boundary:  'zone-tag-boundary',
  dt_loading:   'zone-tag-loading',
  dt_unloading: 'zone-tag-unloading',
  dt_onsite:    'zone-tag-onsite',
  dst_zone:     'zone-tag-dst',
};

export function showObjectZones(
  objectUid: string,
  zones: ZoneInfo[],
  handlers: ZoneHandlers,
): void {
  const item = document.querySelector(`.object-item[data-uid="${objectUid}"]`);
  if (!item) return;

  let zonesEl = item.querySelector('.object-zones');
  if (!zonesEl) {
    zonesEl = document.createElement('div');
    zonesEl.className = 'object-zones';
    item.appendChild(zonesEl);
  }

  if (zones.length === 0) {
    zonesEl.innerHTML = '<div class="zone-item empty">Зоны не найдены</div>';
    return;
  }

  zonesEl.innerHTML = zones.map(z => {
    const tagBadges = z.tags
      .map(t => `<span class="zone-tag ${TAG_BADGE_CLASS[t] ?? ''}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</span>`)
      .join('');
    return `
      <div class="zone-item" data-uid="${escapeHtml(z.uid)}">
        <span class="zone-item-name">● ${escapeHtml(z.name)}</span>
        <span class="zone-tags">${tagBadges}</span>
        <span class="zone-actions">
          <button class="zone-btn zone-btn-zoom" title="Приблизить">🔍</button>
          <button class="zone-btn zone-btn-edit" title="Редактировать">✏</button>
          <button class="zone-btn zone-btn-delete" title="Удалить">🗑</button>
        </span>
      </div>`;
  }).join('');

  zonesEl.querySelectorAll<HTMLElement>('.zone-item[data-uid]').forEach(row => {
    const uid = row.dataset.uid!;
    const zone = zones.find(z => z.uid === uid);
    if (!zone) return;

    row.querySelector('.zone-btn-zoom')?.addEventListener('click', (e) => {
      e.stopPropagation();
      handlers.onZoom(uid);
    });
    row.querySelector('.zone-btn-edit')?.addEventListener('click', (e) => {
      e.stopPropagation();
      handlers.onEdit(uid, { name: zone.name, tags: zone.tags });
    });
    row.querySelector('.zone-btn-delete')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Удалить зону «${zone.name}»?`)) return;
      await handlers.onDelete(uid);
    });
  });
}

export function showNewObjectForm(onSubmit: (data: {
  name: string; smu: string; region: string;
}) => void): void {
  const modal = document.getElementById('modal');
  const content = document.getElementById('modal-content');
  if (!modal || !content) return;

  content.innerHTML = `
    <h3>Новый объект</h3>
    <form id="new-object-form">
      <label>Название объекта *
        <input type="text" name="name" required placeholder="Карьер Сингапай" />
      </label>
      <label>СМУ
        <input type="text" name="smu" placeholder="СМУ г. Тюмень" />
      </label>
      <label>Регион
        <input type="text" name="region" placeholder="Тюменская область" />
      </label>
      <div class="form-actions">
        <button type="submit" class="btn-primary">Создать</button>
        <button type="button" class="btn-cancel" id="modal-close">Отмена</button>
      </div>
    </form>
  `;

  modal.classList.remove('hidden');
  document.getElementById('modal-close')?.addEventListener('click', hideModal);
  document.getElementById('new-object-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data = {
      name:   (form.elements.namedItem('name') as HTMLInputElement).value.trim(),
      smu:    (form.elements.namedItem('smu') as HTMLInputElement).value.trim(),
      region: (form.elements.namedItem('region') as HTMLInputElement).value.trim(),
    };
    hideModal();
    onSubmit(data);
  });
}

export function showNewZoneForm(
  objects: GeoObject[],
  onSubmit: (data: {
    objectUid: string; name: string; tags: string[];
  }) => void,
): void {
  const modal = document.getElementById('modal');
  const content = document.getElementById('modal-content');
  if (!modal || !content) return;

  const ALL_TAGS = [
    { value: 'dt_boundary',  label: 'Граница объекта (самосвалы)' },
    { value: 'dt_loading',   label: 'Зона погрузки (самосвалы)' },
    { value: 'dt_unloading', label: 'Зона выгрузки (самосвалы)' },
    { value: 'dt_onsite',    label: 'Работа по месту (самосвалы)' },
    { value: 'dst_zone',     label: 'Рабочая зона (КИП/ДСТ)' },
  ];

  const objectOptions = objects
    .map(o => `<option value="${o.uid}">${escapeHtml(o.name)}</option>`)
    .join('');

  const tagCheckboxes = ALL_TAGS
    .map(t => `
      <label class="tag-label">
        <input type="checkbox" name="tag" value="${t.value}" />
        ${t.label}
      </label>`)
    .join('');

  content.innerHTML = `
    <h3>Новая зона</h3>
    <form id="new-zone-form">
      <label>Объект *
        <select name="objectUid" required>${objectOptions}</select>
      </label>
      <label>Название зоны *
        <input type="text" name="zoneName" required placeholder="Карьер Сингапай" />
      </label>
      <fieldset>
        <legend>Теги</legend>
        ${tagCheckboxes}
      </fieldset>
      <div class="form-actions">
        <button type="submit" class="btn-primary">Сохранить</button>
        <button type="button" class="btn-cancel" id="modal-close">Отмена</button>
      </div>
    </form>
  `;

  modal.classList.remove('hidden');
  document.getElementById('modal-close')?.addEventListener('click', hideModal);
  document.getElementById('new-zone-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const checkedTags = Array.from(
      form.querySelectorAll<HTMLInputElement>('input[name="tag"]:checked'),
    ).map(el => el.value);

    hideModal();
    onSubmit({
      objectUid: (form.elements.namedItem('objectUid') as HTMLSelectElement).value,
      name:      (form.elements.namedItem('zoneName') as HTMLInputElement).value.trim(),
      tags:      checkedTags,
    });
  });
}

export function showEditZoneForm(
  current: { name: string; tags: string[] },
  onSubmit: (data: { name: string; tags: string[] }) => void,
): void {
  const modal = document.getElementById('modal');
  const content = document.getElementById('modal-content');
  if (!modal || !content) return;

  const ALL_TAGS = [
    { value: 'dt_boundary',  label: 'Граница объекта (самосвалы)' },
    { value: 'dt_loading',   label: 'Зона погрузки (самосвалы)' },
    { value: 'dt_unloading', label: 'Зона выгрузки (самосвалы)' },
    { value: 'dt_onsite',    label: 'Работа по месту (самосвалы)' },
    { value: 'dst_zone',     label: 'Рабочая зона (КИП/ДСТ)' },
  ];

  const tagCheckboxes = ALL_TAGS
    .map(t => `
      <label class="tag-label">
        <input type="checkbox" name="tag" value="${t.value}"${current.tags.includes(t.value) ? ' checked' : ''} />
        ${t.label}
      </label>`)
    .join('');

  content.innerHTML = `
    <h3>Редактировать зону</h3>
    <form id="edit-zone-form">
      <label>Название зоны *
        <input type="text" name="zoneName" required value="${escapeHtml(current.name)}" />
      </label>
      <fieldset>
        <legend>Теги</legend>
        ${tagCheckboxes}
      </fieldset>
      <div class="form-actions">
        <button type="submit" class="btn-primary">Сохранить</button>
        <button type="button" class="btn-cancel" id="modal-close">Отмена</button>
      </div>
    </form>
  `;

  modal.classList.remove('hidden');
  document.getElementById('modal-close')?.addEventListener('click', hideModal);
  document.getElementById('edit-zone-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const checkedTags = Array.from(
      form.querySelectorAll<HTMLInputElement>('input[name="tag"]:checked'),
    ).map(el => el.value);

    hideModal();
    onSubmit({
      name: (form.elements.namedItem('zoneName') as HTMLInputElement).value.trim(),
      tags: checkedTags,
    });
  });
}

export function hideModal(): void {
  const modal = document.getElementById('modal');
  modal?.classList.add('hidden');
}

export function showError(message: string): void {
  const el = document.getElementById('error-banner');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
