/* ============================================================
   Выдача топлива — единый кликабельный прототип
   Все экраны в одном документе, сквозная навигация по кнопкам.
   Граф переходов — по «Схема потока экранов» (flow.js).
   ============================================================ */

const byId = id => document.getElementById(id);
const ru = n => n.toLocaleString('ru');

/* ── Масштабирование планшета под вьюпорт (минус нижняя панель) ── */
function scaleTablet() {
  const t = byId('tablet'); if (!t) return;
  const pad = 32, rail = 76;
  const s = Math.min((innerWidth - pad) / 1280, (innerHeight - pad - rail) / 800, 1);
  t.style.transform = `scale(${s})`;
}
addEventListener('resize', scaleTablet);
addEventListener('load', scaleTablet);
scaleTablet();

/* ── Иконки ──────────────────────────────────────────────── */
byId('lb-atz-ico').innerHTML = VEH.semiTruck;
byId('home-atz-ico').innerHTML = VEH.semiTruck;

/* ── Единое переключение экранов ─────────────────────────── */
function show(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('is-active', v.dataset.view === view));
  const body = document.querySelector('.view.is-active .screen-body');
  if (body) body.scrollTo(0, 0);
  document.querySelectorAll('#navRail button[data-go]').forEach(b => b.classList.toggle('is-on', b.dataset.go === view));
}

/* nav-rail: прыжок на экран с корректной инициализацией */
function nav(view) {
  if (view === 'pick')  return goGive();
  if (view === 'add')   return goAdd();
  if (view === 'recv')  return openRecv();
  if (view === 'start') return goStart();
  if (view === 'work')  { ensureShift(); renderWork(); }
  if (view === 'login') { pin = ''; renderPin(); }
  show(view);
}

/* ── Общий стейт смены ───────────────────────────────────── */
const S = {
  atzPlate: 'Х 214 ТТ 138',
  atzDesc:  'УРАЛ 4320 · автотопливозаправщик',
  shiftNo:  'С1',
  opening:  8420,           // остаток на старте смены
  shiftStart: null,
  selected: null,           // выбранное ТС для выдачи
  amt: 0,
  recvAmt: 0,
  hasPhoto: false,
  editId: null,
  editLiters: 0,
  seq: 100,
  log: [
    { id:1, kind:'give', plate:'А 145 КН 138', type:'dumpTruck', model:'Самосвал КАМАЗ 6520', org:'НПС Спецтехника', liters:540, time:'09:14', queued:false },
    { id:2, kind:'give', plate:'М 902 ОР 28',  type:'excavator', model:'Экскаватор Caterpillar 329', org:'НПС Карьер', liters:320, time:'10:02', queued:true },
    { id:3, kind:'give', plate:'К 771 ТС 138', type:'heavy',     model:'Бульдозер ЧЕТРА Т-11', org:'НПС Спецтехника', liters:410, time:'11:21', queued:true },
  ],
};

function totals() {
  let given = 0, recv = 0, plates = new Set();
  S.log.forEach(r => {
    if (r.kind === 'give') { given += r.liters; plates.add(r.plate); }
    else recv += r.liters;
  });
  return { given, recv, count: S.log.length, ts: plates.size, remain: S.opening + recv - given };
}
function nowHM() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/* ════════ ВХОД ════════ */
let pin = '';
const PIN_OK = '1234';
function renderPin() {
  byId('pinDots').querySelectorAll('.pd').forEach((d, i) => { d.classList.toggle('filled', i < pin.length); d.classList.remove('err'); });
}
byId('loginKeypad').addEventListener('click', e => {
  const k = e.target.closest('.key'); if (!k) return;
  const v = k.dataset.k;
  byId('pinErr').textContent = '';
  if (v === 'del') { pin = pin.slice(0, -1); renderPin(); return; }
  if (v === 'switch') { byId('pinErr').textContent = 'Выбор заправщика — следующая итерация'; return; }
  if (pin.length >= 4) return;
  pin += v; renderPin();
  if (pin.length === 4) setTimeout(checkPin, 180);
});
function checkPin() {
  if (pin === PIN_OK) { pin = ''; renderPin(); show('home'); }
  else {
    byId('pinDots').querySelectorAll('.pd').forEach(d => d.classList.add('err'));
    byId('pinErr').textContent = 'Неверный PIN. Попробуйте ещё раз';
    setTimeout(() => { pin = ''; renderPin(); }, 600);
  }
}
function logout() { pin = ''; renderPin(); show('login'); }

/* ════════ ГЛАВНАЯ · прошлые смены ════════ */
const SHIFTS = [
  { date:'11.05.2026', shift:'С1', time:'08:02 — 17:40', ts:11, given:4120 },
  { date:'10.05.2026', shift:'С1', time:'07:58 — 18:05', ts:14, given:5360 },
  { date:'08.05.2026', shift:'С2', time:'19:55 — 04:30', ts:7,  given:2840 },
  { date:'07.05.2026', shift:'С1', time:'08:10 — 17:20', ts:9,  given:3510 },
];
byId('shiftList').innerHTML = SHIFTS.map(s => `
  <div class="shift-card">
    <div class="row" style="justify-content:space-between;align-items:baseline">
      <span class="t-body-strong">${s.date}</span>
      <span class="t-caption" style="font-weight:600">${s.shift} · ${s.time}</span>
    </div>
    <div class="sc-stats">
      <div class="sc-stat"><span class="t-label">ТС</span><span class="t-heading">${s.ts}</span></div>
      <div class="sc-stat"><span class="t-label">Выдано</span><span class="t-heading">${ru(s.given)} л</span></div>
    </div>
  </div>`).join('');

/* ════════ ПРОФИЛЬ · история ════════ */
const HISTORY = [
  { date:'11.05.2026', shift:'С1', atz:'Х 214 ТТ 138', type:'semiTruck', from:'08:02', to:'17:40', ts:11, liters:4120 },
  { date:'10.05.2026', shift:'С1', atz:'Х 214 ТТ 138', type:'semiTruck', from:'07:58', to:'18:05', ts:14, liters:5360 },
  { date:'08.05.2026', shift:'С2', atz:'Н 086 ОР 138', type:'semiTruck', from:'19:55', to:'04:30', ts:7,  liters:2840 },
  { date:'07.05.2026', shift:'С1', atz:'Х 214 ТТ 138', type:'semiTruck', from:'08:10', to:'17:20', ts:9,  liters:3510 },
  { date:'06.05.2026', shift:'С1', atz:'С 510 ТК 38',  type:'semiTruck', from:'08:00', to:'16:48', ts:6,  liters:2210 },
  { date:'05.05.2026', shift:'С2', atz:'Н 086 ОР 138', type:'semiTruck', from:'20:02', to:'05:10', ts:10, liters:3980 },
];
byId('histCount').textContent = `показаны последние ${HISTORY.length}`;
byId('histScroll').innerHTML = HISTORY.map(h => `
  <div class="card hist-card">
    <div class="hc-atz"><div class="hc-icon">${VEH[h.type]}</div></div>
    <div class="hc-when">
      <span class="t-body-strong" style="font-variant-numeric:tabular-nums">${h.atz}</span>
      <span class="t-caption">${h.date} · ${h.shift} · ${h.from} — ${h.to}</span>
    </div>
    <div class="hc-stats">
      <div class="hc-stat"><span class="t-label">ТС</span><span class="v">${h.ts}</span></div>
      <div class="hc-stat"><span class="t-label">Выдано</span><span class="v">${ru(h.liters)} л</span></div>
    </div>
  </div>`).join('');

/* ════════ СТАРТ СМЕНЫ ════════ */
const ATZ = [
  { plate:'Х 214 ТТ 138', desc:'УРАЛ 4320 · автотопливозаправщик', type:'semiTruck', fuel:8420,  cap:16000 },
  { plate:'Н 086 ОР 138', desc:'КАМАЗ 43118 · АТЗ-10', type:'semiTruck', fuel:11200, cap:12000 },
  { plate:'С 510 ТК 38',  desc:'МАЗ 5337 · АТЗ-7,5', type:'semiTruck', fuel:4300,  cap:10000 },
];
let selAtz = 0;
function goStart() { renderAtzList(); show('start'); }
function renderAtzList() {
  byId('atzListLabel').textContent = `Доступные АТЗ · ${ATZ.length}`;
  byId('atzList').innerHTML = ATZ.map((a, i) => `
    <div class="atz-opt ${i === selAtz ? 'is-sel' : ''}" onclick="pickAtz(${i})">
      <div class="ao-radio"></div>
      <div class="ao-icon">${VEH[a.type]}</div>
      <div class="ao-main">
        <div class="ao-plate">${a.plate}</div>
        <div class="ao-desc">${a.desc}</div>
      </div>
      <div class="ao-fuel"><div class="v">${ru(a.fuel)} л</div><div class="t-caption">из ${ru(a.cap/1000)} тыс.</div></div>
    </div>`).join('');
  renderAtzDetail();
}
function pickAtz(i) { selAtz = i; renderAtzList(); }
function renderAtzDetail() {
  const a = ATZ[selAtz];
  byId('sdPlate').textContent = a.plate;
  byId('sdDesc').textContent = a.desc;
  byId('sdNum').textContent = ru(a.fuel);
  const pct = Math.round(a.fuel / a.cap * 100);
  byId('sdBar').style.width = pct + '%';
  byId('sdCap').textContent = `${ru(a.fuel)} / ${ru(a.cap)} л · ${pct}%`;
  byId('startCtaLabel').textContent = `Начать смену на ${a.plate}`;
}
function confirmStart() {
  const a = ATZ[selAtz];
  S.atzPlate = a.plate; S.atzDesc = a.desc; S.opening = a.fuel;
  S.log = [];                         // свежая смена — пустой журнал
  S.shiftStart = Date.now();
  byId('wkWhoRl').textContent = `${S.shiftNo} · ${a.plate}`;
  renderWork();
  show('work');
}

/* ════════ РАБОЧИЙ РЕЖИМ ════════ */
function ensureShift() {
  if (!S.shiftStart) S.shiftStart = Date.now() - (3 * 3600 + 41 * 60) * 1000;  // ~03:41 для ревью
}
const editIco = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const recvBadge = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/></svg>`;

function renderWork() {
  const t = totals();
  byId('wkRemain').textContent = ru(t.remain);
  byId('wkGiven').textContent = ru(t.given) + ' л';
  byId('wkRecv').textContent = ru(t.recv) + ' л';
  byId('wkCount').textContent = t.count;
  renderLog();
  updateSync();
}
function renderLog() {
  const wrap = byId('logScroll');
  if (S.log.length === 0) {
    wrap.innerHTML = `<div class="log-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 5h16M4 12h16M4 19h10"/></svg>
      <div class="t-body" style="color:var(--ink-3)">Записей пока нет</div>
      <div class="t-caption">Нажмите «Передача топлива», чтобы выдать топливо технике</div>
    </div>`;
    return;
  }
  wrap.innerHTML = S.log.map(r => {
    const isRecv = r.kind === 'receive';
    return `<div class="fuel-row ${isRecv ? 'fuel-row--receive' : 'fuel-row--give'}">
      <div class="fr-mark"></div>
      <div class="fr-icon">${isRecv ? recvBadge : VEH[r.type]}</div>
      <div class="fr-main">
        <span class="t-body-strong" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${isRecv ? 'Получение в АТЗ' : r.plate}${r.queued ? '<span class="chip-queued"><span class="dot"></span>в очереди</span>' : ''}</span>
        <span class="t-caption">${isRecv ? ('ТТН · ' + r.time) : (r.model + ' · ' + r.time)}</span>
      </div>
      <span class="fr-liters">${isRecv ? '+' : ''}${ru(r.liters)} л</span>
      <button class="fr-edit" onclick="openEdit(${r.id})" title="Редактировать">${editIco}</button>
    </div>`;
  }).join('');
}
function updateSync() {
  const q = S.log.filter(r => r.queued).length;
  const pill = byId('wkSync');
  if (pill.classList.contains('is-syncing')) return;
  if (q > 0) { pill.className = 'sync-pill is-offline'; pill.innerHTML = `<span class="dot"></span>Офлайн · <span id="wkQCount">${q}</span> в очереди`; }
  else { pill.className = 'sync-pill is-synced'; pill.innerHTML = `<span class="dot"></span>Синхронизировано`; }
}
function manualSync() {
  const q = S.log.filter(r => r.queued).length;
  if (q === 0) return;
  const pill = byId('wkSync');
  pill.className = 'sync-pill is-syncing';
  pill.innerHTML = '<span class="dot"></span>Синхронизация…';
  setTimeout(() => { S.log.forEach(r => r.queued = false); renderLog(); updateSync(); }, 1500);
}

/* живой таймер смены */
setInterval(() => {
  if (!S.shiftStart) return;
  const el = byId('wkTimer'); if (!el) return;
  let s = Math.floor((Date.now() - S.shiftStart) / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  el.textContent = `${h}:${m}:${String(s % 60).padStart(2, '0')}`;
}, 1000);

/* ════════ ПЕРЕДАЧА · данные ════════ */
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
const chev = `<svg class="vo-chev" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;

function goGive() {
  ensureShift();
  byId('pickCtx').textContent = ru(totals().remain) + ' л';
  byId('vehSearch').value = '';
  renderList('');
  show('pick');
}
function optionHTML(v, internal) {
  return `<div class="vehicle-option ${internal ? 'is-internal' : ''}" onclick='selectVehicle(${JSON.stringify(v)})'>
    <div class="vo-icon">${VEH[v.type]}</div>
    <div class="vo-main"><span class="vo-plate">${v.plate}</span><span class="vo-meta">${v.model} · ${v.org}</span></div>${chev}
  </div>`;
}
function renderList(q = '') {
  const norm = s => s.toUpperCase().replace(/\s/g, '');
  const f = v => norm(v.plate).includes(norm(q));
  const inMatch = VEHICLES.internal.filter(f);
  const hiMatch = VEHICLES.hired.filter(f);
  const list = byId('pickList'), addBtn = byId('addBtn');
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
byId('vehSearch').addEventListener('input', e => renderList(e.target.value));

/* ── Шаг 2 — литры ── */
function selectVehicle(v) {
  S.selected = v; S.amt = 0;
  byId('selIcon').innerHTML = VEH[v.type];
  byId('selPlate').textContent = v.plate;
  byId('selMeta').textContent = `${v.model} · ${v.org}`;
  byId('amtCtx').textContent = ru(totals().remain) + ' л';
  renderAmt();
  show('amount');
}
function renderAmt() {
  const remain = totals().remain;
  const numEl = byId('amtNum');
  numEl.textContent = ru(S.amt);
  numEl.classList.toggle('is-empty', S.amt === 0);
  const after = remain - S.amt, over = S.amt > remain;
  const afterEl = byId('amtAfter');
  afterEl.classList.toggle('is-over', over);
  afterEl.innerHTML = over
    ? `Превышает остаток АТЗ на <span class="v">${ru(S.amt - remain)} л</span>`
    : `Остаток после выдачи: <span class="v">${ru(after)} л</span>`;
  const btn = byId('confirmBtn');
  if (S.amt === 0) { btn.disabled = true; btn.textContent = 'Введите объём'; }
  else if (over) { btn.disabled = true; btn.textContent = 'Превышает остаток'; }
  else { btn.disabled = false; btn.textContent = `Выдать ${ru(S.amt)} л`; }
}
byId('amtKeypad').addEventListener('click', e => {
  const k = e.target.closest('.key'); if (!k) return;
  const v = k.dataset.k;
  if (v === 'clear') S.amt = 0;
  else if (v === 'del') S.amt = Math.floor(S.amt / 10);
  else { if (String(S.amt).length >= 5) return; S.amt = S.amt * 10 + Number(v); }
  renderAmt();
});
function quickAmt(n) { S.amt = Math.min(99999, S.amt + n); renderAmt(); }
function confirmGive() {
  const v = S.selected;
  S.log.unshift({ id: ++S.seq, kind:'give', plate:v.plate, type:v.type, model:v.model, org:v.org, liters:S.amt, time:nowHM(), queued:true });
  showToast(`Выдано ${ru(S.amt)} л · ${v.plate}`);
  renderWork();
  show('work');
}

/* ════════ ДОБАВЛЕНИЕ ТС ════════ */
let addType = null;
function goAdd() {
  const q = byId('vehSearch').value.trim();
  byId('newPlate').value = q;
  byId('newOrg').value = '';
  byId('newBrand').value = '';
  addType = null;
  byId('orgNote').classList.remove('show');
  closeOrgMenu();
  renderTypeChips();
  validateAdd();
  show('add');
}
function renderTypeChips() {
  byId('typeChips').innerHTML = TYPES.map(t => `<button class="type-chip ${addType === t ? 'is-active' : ''}" onclick="pickType('${t}')">${t}</button>`).join('');
}
function pickType(t) { addType = t; renderTypeChips(); validateAdd(); }
function renderOrgMenu(filter = '') {
  byId('orgMenu').innerHTML = ORGS.filter(o => o.name.toLowerCase().includes(filter.toLowerCase()))
    .map(o => `<div class="om-item" onclick="pickOrg('${o.name.replace(/'/g, "\\'")}')">${o.name}<span class="om-tag">${o.kind}</span></div>`).join('');
}
function openOrgMenu() { renderOrgMenu(byId('newOrg').value); byId('orgMenu').classList.add('is-open'); }
function closeOrgMenu() { byId('orgMenu').classList.remove('is-open'); }
function pickOrg(name) { byId('newOrg').value = name; byId('orgNote').classList.remove('show'); closeOrgMenu(); validateAdd(); }
function onOrgInput() {
  const val = byId('newOrg').value.trim();
  const known = ORGS.some(o => o.name.toLowerCase() === val.toLowerCase());
  byId('orgNote').classList.toggle('show', val.length > 0 && !known);
  renderOrgMenu(val);
  byId('orgMenu').classList.toggle('is-open', !(val.length > 0 && !known));
  validateAdd();
}
document.addEventListener('click', e => { if (!e.target.closest('.org-pop')) closeOrgMenu(); });
function validateAdd() {
  byId('saveBtn').disabled = !(byId('newPlate').value.trim() && byId('newOrg').value.trim() && addType);
}
function saveVehicle() {
  const plate = byId('newPlate').value.trim();
  const org = byId('newOrg').value.trim();
  const brand = byId('newBrand').value.trim();
  const known = ORGS.some(o => o.name.toLowerCase() === org.toLowerCase());
  const v = { plate, type: TYPE_ICON[addType] || 'heavy', model: brand ? `${addType} ${brand}` : addType, org };
  if (!known) { VEHICLES.hired.unshift(v); ORGS.push({ name: org, kind: 'Наёмник' }); }
  else {
    const internal = ORGS.find(o => o.name === org)?.kind === 'Внутренняя';
    (internal ? VEHICLES.internal : VEHICLES.hired).unshift(v);
  }
  selectVehicle(v);                 // мгновенный возврат на шаг литров с выбранным ТС
  showToast('ТС добавлено и выбрано');
}

/* ════════ ПОЛУЧЕНИЕ ТОПЛИВА ════════ */
function openRecv() {
  ensureShift();
  S.recvAmt = 0; S.hasPhoto = false; resetPhoto();
  byId('recvCtx').textContent = ru(totals().remain) + ' л';
  renderRecv();
  show('recv');
}
function renderRecv() {
  const remain = totals().remain;
  const numEl = byId('recvNum');
  numEl.textContent = ru(S.recvAmt);
  numEl.classList.toggle('is-empty', S.recvAmt === 0);
  byId('recvAfter').innerHTML = `Остаток после приёма: <span class="v">${ru(remain + S.recvAmt)} л</span>`;
  const btn = byId('recvConfirm');
  if (S.recvAmt === 0) { btn.disabled = true; btn.textContent = 'Введите объём'; }
  else { btn.disabled = false; btn.textContent = `Принять ${ru(S.recvAmt)} л`; }
}
byId('recvKeypad').addEventListener('click', e => {
  const k = e.target.closest('.key'); if (!k) return;
  const v = k.dataset.k;
  if (v === 'clear') S.recvAmt = 0;
  else if (v === 'del') S.recvAmt = Math.floor(S.recvAmt / 10);
  else { if (String(S.recvAmt).length >= 5) return; S.recvAmt = S.recvAmt * 10 + Number(v); }
  renderRecv();
});
function attachPhoto() {
  S.hasPhoto = true;
  byId('ttnDrop').classList.add('hide');
  byId('ttnPreview').classList.add('show');
  setStatus('queued', 'В очереди на загрузку (офлайн)');
}
function setStatus(kind, text) {
  const el = byId('ttnStatus');
  el.className = 'ttn-status ' + kind;
  byId('ttnStatusText').textContent = text;
  el.querySelector('.s-ico').innerHTML = kind === 'ok'
    ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
    : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6v6l4 2"/><circle cx="12" cy="12" r="9"/></svg>';
}
function removePhoto() { S.hasPhoto = false; resetPhoto(); }
function resetPhoto() { byId('ttnDrop').classList.remove('hide'); byId('ttnPreview').classList.remove('show'); }
function confirmRecv() {
  S.log.unshift({ id: ++S.seq, kind:'receive', liters:S.recvAmt, time:nowHM(), queued:true, hasPhoto:S.hasPhoto });
  showToast(`Принято ${ru(S.recvAmt)} л в АТЗ`);
  renderWork();
  show('work');
}

/* ════════ РЕДАКТИРОВАНИЕ (нижний лист) ════════ */
function openEditFirst() {
  if (S.log.length === 0) { showToast('Журнал пуст — нечего редактировать'); return; }
  show('work'); renderWork(); openEdit(S.log[0].id);
}
function openEdit(id) {
  const r = S.log.find(x => x.id === id); if (!r) return;
  S.editId = id; S.editLiters = r.liters;
  byId('edIcon').innerHTML = r.kind === 'receive' ? recvBadge : VEH[r.type];
  byId('edPlate').textContent = r.kind === 'receive' ? 'Получение в АТЗ' : r.plate;
  byId('edMeta').textContent = r.kind === 'receive' ? ('ТТН · ' + r.time) : (r.model + ' · ' + r.time);
  byId('edChangePlate').textContent = r.kind === 'receive' ? ('АТЗ ' + S.atzPlate) : r.plate;
  byId('edLiters').textContent = ru(S.editLiters);
  byId('esMain').classList.remove('hide');
  byId('esConfirmDel').classList.remove('show');
  byId('editOverlay').classList.add('show');
}
function stepEd(d) { S.editLiters = Math.max(0, S.editLiters + d); byId('edLiters').textContent = ru(S.editLiters); }
function closeEdit() { byId('editOverlay').classList.remove('show'); }
function saveEdit() {
  const r = S.log.find(x => x.id === S.editId);
  if (r) { r.liters = S.editLiters; r.queued = true; }
  closeEdit(); renderWork(); showToast('Запись обновлена');
}
function askDelete() {
  const r = S.log.find(x => x.id === S.editId);
  byId('delPlate').textContent = r.kind === 'receive' ? 'Получение в АТЗ' : r.plate;
  byId('esMain').classList.add('hide');
  byId('esConfirmDel').classList.add('show');
}
function cancelDelete() { byId('esMain').classList.remove('hide'); byId('esConfirmDel').classList.remove('show'); }
function confirmDelete() {
  S.log = S.log.filter(x => x.id !== S.editId);
  closeEdit(); renderWork(); showToast('Запись удалена');
}

/* ════════ ЗАКРЫТИЕ СМЕНЫ ════════ */
function openClose() {
  ensureShift();
  const t = totals();
  byId('clTs').textContent = t.ts;
  byId('clRecCount').textContent = t.count;
  byId('clGiven').textContent = ru(t.given);
  byId('clRecvSum').textContent = ru(t.recv);
  byId('clFinal').textContent = ru(t.remain);
  byId('closeOverlay').classList.add('show');
}
function closeCloseModal() { byId('closeOverlay').classList.remove('show'); }
function confirmClose() {
  closeCloseModal();
  S.shiftStart = null;
  showToast('Смена закрыта · записи отправятся при связи');
  setTimeout(() => { logout(); }, 700);
}

/* ════════ TOAST ════════ */
let toastTimer = null;
function showToast(msg) {
  byId('toastMsg').textContent = msg;
  byId('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => byId('toast').classList.remove('show'), 2600);
}

/* ── init ── */
renderWork();
show('login');
