/* ============================================================
   Передача топлива — выбор ТС, ввод литров, добавление ТС
   ============================================================ */

function scaleTablet() {
  const t = document.getElementById('tablet'); if (!t) return;
  const pad = 32;
  const s = Math.min((innerWidth - pad) / 1280, (innerHeight - pad) / 800, 1);
  t.style.transform = `scale(${s})`;
}
addEventListener('resize', scaleTablet);
addEventListener('load', scaleTablet);
scaleTablet();

function show(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('is-active', v.dataset.view === view));
}

/* ── Data ─────────────────────────────────────────────── */
const ATZ_REMAIN = 8420;
const TYPE_ICON = { 'Экскаватор':'excavator', 'Бульдозер':'heavy', 'Самосвал':'dumpTruck', 'Погрузчик':'heavy', 'Автокран':'heavy', 'Седельный тягач':'semiTruck', 'Другое':'heavy' };

const VEHICLES = {
  internal: [
    { plate:'А 145 КН 138', type:'dumpTruck', model:'Самосвал КАМАЗ 6520', org:'НПС Спецтехника' },
    { plate:'К 771 ТС 138', type:'heavy',     model:'Бульдозер ЧЕТРА Т-11', org:'НПС Спецтехника' },
    { plate:'М 902 ОР 28',  type:'excavator', model:'Экскаватор Caterpillar 329', org:'НПС Карьер' },
    { plate:'В 058 ХМ 138', type:'heavy',     model:'Погрузчик XCMG LW500', org:'НПС Карьер' },
  ],
  hired: [
    { plate:'Т 330 ВА 138', type:'dumpTruck', model:'Самосвал HOWO TX', org:'ООО СтройТранс' },
    { plate:'Е 412 РК 138', type:'excavator', model:'Экскаватор Hitachi ZX240', org:'ООО СтройТранс' },
    { plate:'У 199 ОО 38',  type:'dumpTruck', model:'Самосвал Shacman X3000', org:'ИП Сидоров А. П.' },
  ],
};
const ORGS = [
  { name:'НПС Спецтехника', kind:'Внутренняя' },
  { name:'НПС Карьер', kind:'Внутренняя' },
  { name:'ООО СтройТранс', kind:'Наёмник' },
  { name:'ИП Сидоров А. П.', kind:'Наёмник' },
];
const TYPES = ['Экскаватор','Бульдозер','Самосвал','Погрузчик','Автокран','Другое'];

/* ── ШАГ 1 — render list with org grouping + search ─────── */
const chev = `<svg class="vo-chev" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;

function optionHTML(v, internal) {
  return `<div class="vehicle-option ${internal ? 'is-internal' : ''}" onclick='selectVehicle(${JSON.stringify(v)})'>
    <div class="vo-icon">${VEH[v.type]}</div>
    <div class="vo-main">
      <span class="vo-plate">${v.plate}</span>
      <span class="vo-meta">${v.model} · ${v.org}</span>
    </div>${chev}
  </div>`;
}

function renderList(q = '') {
  const norm = s => s.toUpperCase().replace(/\s/g, '');
  const f = v => norm(v.plate).includes(norm(q));
  const inMatch = VEHICLES.internal.filter(f);
  const hiMatch = VEHICLES.hired.filter(f);
  const list = document.getElementById('pickList');
  const addBtn = document.getElementById('addBtn');

  if (q && inMatch.length === 0 && hiMatch.length === 0) {
    list.innerHTML = `<div class="pick-empty">
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" stroke-width="1.6" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <div class="t-heading">Ничего не найдено</div>
      <div class="t-body" style="color:var(--ink-3)">«<span class="pe-num">${q}</span>» нет в списке. Добавьте новое ТС — оно сразу станет доступно для выдачи.</div>
    </div>`;
    addBtn.classList.add('is-cta');
    addBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> Добавить «${q}»`;
    return;
  }
  addBtn.classList.remove('is-cta');
  addBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg> Добавить ТС`;

  let html = '';
  if (inMatch.length) html += `<div class="org-section-header">Внутренние</div>` + inMatch.map(v => optionHTML(v, true)).join('');
  if (hiMatch.length) html += `<div class="org-section-header">Наёмные</div>` + hiMatch.map(v => optionHTML(v, false)).join('');
  list.innerHTML = html;
}

document.getElementById('vehSearch').addEventListener('input', e => renderList(e.target.value));
renderList();

/* ── ШАГ 2 — amount entry ─────────────────────────────── */
let selected = null;
let amt = 0;

function selectVehicle(v) {
  selected = v;
  amt = 0;
  document.getElementById('selIcon').innerHTML = VEH[v.type];
  document.getElementById('selPlate').textContent = v.plate;
  document.getElementById('selMeta').textContent = `${v.model} · ${v.org}`;
  renderAmt();
  show('amount');
}

function renderAmt() {
  const numEl = document.getElementById('amtNum');
  numEl.textContent = amt.toLocaleString('ru');
  numEl.classList.toggle('is-empty', amt === 0);

  const after = ATZ_REMAIN - amt;
  const afterEl = document.getElementById('amtAfter');
  const over = amt > ATZ_REMAIN;
  afterEl.classList.toggle('is-over', over);
  afterEl.innerHTML = over
    ? `Превышает остаток АТЗ на <span class="v">${(amt - ATZ_REMAIN).toLocaleString('ru')} л</span>`
    : `Остаток после выдачи: <span class="v">${after.toLocaleString('ru')} л</span>`;

  const btn = document.getElementById('confirmBtn');
  if (amt === 0) { btn.disabled = true; btn.textContent = 'Введите объём'; }
  else if (over) { btn.disabled = true; btn.textContent = 'Превышает остаток'; }
  else { btn.disabled = false; btn.textContent = `Выдать ${amt.toLocaleString('ru')} л`; }
}

document.getElementById('amtKeypad').addEventListener('click', e => {
  const k = e.target.closest('.key'); if (!k) return;
  const v = k.dataset.k;
  if (v === 'clear') amt = 0;
  else if (v === 'del') amt = Math.floor(amt / 10);
  else { if (String(amt).length >= 5) return; amt = amt * 10 + Number(v); }
  renderAmt();
});
function quickAmt(n) { amt = Math.min(99999, amt + n); renderAmt(); }

function confirmGive() {
  showToast(`Выдано ${amt.toLocaleString('ru')} л · ${selected.plate}`);
  setTimeout(() => alert('Запись добавлена в журнал смены (см. «Рабочий режим»). Возврат в рабочий режим.'), 400);
}

/* ── ДОБАВЛЕНИЕ ТС ────────────────────────────────────── */
let addType = null;
let prefillPlate = '';

function goAdd() {
  // prefill plate from search if user searched something not found
  const q = document.getElementById('vehSearch').value.trim();
  prefillPlate = q;
  document.getElementById('newPlate').value = q;
  document.getElementById('newOrg').value = '';
  document.getElementById('newBrand').value = '';
  addType = null;
  document.getElementById('orgNote').classList.remove('show');
  closeOrgMenu();
  renderTypeChips();
  validateAdd();
  show('add');
}

function renderTypeChips() {
  document.getElementById('typeChips').innerHTML = TYPES.map(t =>
    `<button class="type-chip ${addType === t ? 'is-active' : ''}" onclick="pickType('${t}')">${t}</button>`
  ).join('');
}
function pickType(t) { addType = t; renderTypeChips(); validateAdd(); }

function renderOrgMenu(filter = '') {
  const menu = document.getElementById('orgMenu');
  const matches = ORGS.filter(o => o.name.toLowerCase().includes(filter.toLowerCase()));
  menu.innerHTML = matches.map(o =>
    `<div class="om-item" onclick="pickOrg('${o.name.replace(/'/g, "\\'")}')">${o.name}<span class="om-tag">${o.kind}</span></div>`
  ).join('') || '';
}
function openOrgMenu() { renderOrgMenu(document.getElementById('newOrg').value); document.getElementById('orgMenu').classList.add('is-open'); }
function closeOrgMenu() { document.getElementById('orgMenu').classList.remove('is-open'); }
function pickOrg(name) {
  document.getElementById('newOrg').value = name;
  document.getElementById('orgNote').classList.remove('show');
  closeOrgMenu(); validateAdd();
}
function onOrgInput() {
  const val = document.getElementById('newOrg').value.trim();
  const known = ORGS.some(o => o.name.toLowerCase() === val.toLowerCase());
  document.getElementById('orgNote').classList.toggle('show', val.length > 0 && !known);
  renderOrgMenu(val);
  document.getElementById('orgMenu').classList.toggle('is-open', val.length > 0 && !known ? false : true);
  if (!known && val.length > 0) closeOrgMenu();
  validateAdd();
}
// close org menu on outside click
document.addEventListener('click', e => {
  if (!e.target.closest('.org-pop')) closeOrgMenu();
});

function validateAdd() {
  const ok = document.getElementById('newPlate').value.trim() && document.getElementById('newOrg').value.trim() && addType;
  document.getElementById('saveBtn').disabled = !ok;
}

function saveVehicle() {
  const plate = document.getElementById('newPlate').value.trim();
  const org = document.getElementById('newOrg').value.trim();
  const brand = document.getElementById('newBrand').value.trim();
  const known = ORGS.some(o => o.name.toLowerCase() === org.toLowerCase());
  const v = {
    plate,
    type: TYPE_ICON[addType] || 'heavy',
    model: brand ? `${addType} ${brand}` : addType,
    org,
  };
  // add to hired group if new org, else find its bucket
  if (!known) { VEHICLES.hired.unshift(v); ORGS.push({ name: org, kind: 'Наёмник' }); }
  else {
    const internal = VEHICLES.internal.length && ORGS.find(o => o.name === org)?.kind === 'Внутренняя';
    (internal ? VEHICLES.internal : VEHICLES.hired).unshift(v);
  }
  // INSTANT RETURN — straight to amount step with the new vehicle selected
  selectVehicle(v);
  showToast('ТС добавлено и выбрано');
}

/* ── Toast ────────────────────────────────────────────── */
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
