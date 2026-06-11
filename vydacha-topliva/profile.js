/* ============================================================
   Профиль / История · Старт смены
   ============================================================ */

function scaleTablet() {
  const t = document.getElementById('tablet'); if (!t) return;
  const pad = 32;
  const s = Math.min((innerWidth - pad) / 1280, (innerHeight - pad - 56) / 800, 1);
  t.style.transform = `scale(${s})`;
}
addEventListener('resize', scaleTablet);
addEventListener('load', scaleTablet);
scaleTablet();

let curScreen = 'profile';
let histState = 'list';   // 'list' | 'empty'
let atzState = 'multi';   // 'multi' | 'single'

function showView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('is-active', v.dataset.view === view));
}

/* ── History data ─────────────────────────────────────── */
const HISTORY = [
  { date:'11.05.2026', shift:'С1', atz:'Х 214 ТТ 138', type:'semiTruck', from:'08:02', to:'17:40', ts:11, liters:4120 },
  { date:'10.05.2026', shift:'С1', atz:'Х 214 ТТ 138', type:'semiTruck', from:'07:58', to:'18:05', ts:14, liters:5360 },
  { date:'08.05.2026', shift:'С2', atz:'Н 086 ОР 138', type:'semiTruck', from:'19:55', to:'04:30', ts:7, liters:2840 },
  { date:'07.05.2026', shift:'С1', atz:'Х 214 ТТ 138', type:'semiTruck', from:'08:10', to:'17:20', ts:9, liters:3510 },
  { date:'06.05.2026', shift:'С1', atz:'С 510 ТК 38', type:'semiTruck', from:'08:00', to:'16:48', ts:6, liters:2210 },
  { date:'05.05.2026', shift:'С2', atz:'Н 086 ОР 138', type:'semiTruck', from:'20:02', to:'05:10', ts:10, liters:3980 },
];

function renderHistory() {
  const wrap = document.getElementById('histScroll');
  const count = document.getElementById('histCount');
  if (histState === 'empty') {
    count.textContent = 'смен ещё не было';
    wrap.innerHTML = `<div class="hist-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>
      <div class="t-heading" style="color:var(--ink-2)">Смен ещё не было</div>
      <div class="t-body" style="color:var(--ink-3);max-width:340px">Завершённые смены появятся здесь: дата, АТЗ, время и сколько топлива выдано.</div>
    </div>`;
    return;
  }
  count.textContent = `показаны последние ${HISTORY.length}`;
  wrap.innerHTML = HISTORY.map(h => `
    <div class="card hist-card">
      <div class="hc-atz">
        <div class="hc-icon">${VEH[h.type]}</div>
      </div>
      <div class="hc-when">
        <span class="t-body-strong" style="font-variant-numeric:tabular-nums">${h.atz}</span>
        <span class="t-caption">${h.date} · ${h.shift} · ${h.from} — ${h.to}</span>
      </div>
      <div class="hc-stats">
        <div class="hc-stat"><span class="t-label">ТС</span><span class="v">${h.ts}</span></div>
        <div class="hc-stat"><span class="t-label">Выдано</span><span class="v">${h.liters.toLocaleString('ru')} л</span></div>
      </div>
    </div>`).join('');
}

/* ── ATZ data ─────────────────────────────────────────── */
const ATZ = [
  { plate:'Х 214 ТТ 138', desc:'УРАЛ 4320 · автотопливозаправщик', type:'semiTruck', fuel:8420, cap:16000 },
  { plate:'Н 086 ОР 138', desc:'КАМАЗ 43118 · АТЗ-10', type:'semiTruck', fuel:11200, cap:12000 },
  { plate:'С 510 ТК 38',  desc:'МАЗ 5337 · АТЗ-7,5', type:'semiTruck', fuel:4300, cap:10000 },
];
let selAtz = 0;

function renderAtzList() {
  const list = atzState === 'single' ? ATZ.slice(0, 1) : ATZ;
  if (atzState === 'single') selAtz = 0;
  document.getElementById('atzListLabel').textContent = atzState === 'single' ? 'Закреплённый АТЗ' : `Доступные АТЗ · ${list.length}`;
  document.getElementById('startStep').textContent = atzState === 'single' ? 'Подтвердите свой АТЗ' : 'Выберите свой АТЗ';
  document.getElementById('atzList').innerHTML = list.map((a, i) => `
    <div class="atz-opt ${i === selAtz ? 'is-sel' : ''}" onclick="pickAtz(${i})">
      ${atzState === 'single' ? '' : '<div class="ao-radio"></div>'}
      <div class="ao-icon">${VEH[a.type]}</div>
      <div class="ao-main">
        <div class="ao-plate">${a.plate}</div>
        <div class="ao-desc">${a.desc}</div>
      </div>
      <div class="ao-fuel"><div class="v">${a.fuel.toLocaleString('ru')} л</div><div class="t-caption">из ${(a.cap/1000).toLocaleString('ru')} тыс.</div></div>
    </div>`).join('');
  renderAtzDetail();
}
function pickAtz(i) { selAtz = i; renderAtzList(); }
function renderAtzDetail() {
  const a = ATZ[selAtz];
  document.getElementById('sdPlate').textContent = a.plate;
  document.getElementById('sdDesc').textContent = a.desc;
  document.getElementById('sdNum').textContent = a.fuel.toLocaleString('ru');
  const pct = Math.round(a.fuel / a.cap * 100);
  document.getElementById('sdBar').style.width = pct + '%';
  document.getElementById('sdCap').textContent = `${a.fuel.toLocaleString('ru')} / ${a.cap.toLocaleString('ru')} л · ${pct}%`;
  document.getElementById('startCtaLabel').textContent = `Начать смену на ${a.plate}`;
}
function confirmStart() {
  alert(`Смена С1 открыта на ${ATZ[selAtz].plate}. Переход в рабочий режим.`);
}

/* ── Screen + state switcher ──────────────────────────── */
function goScreen(screen, btn) {
  curScreen = screen;
  showView(screen);
  document.querySelectorAll('.ss-btn[data-screen]').forEach(b => b.classList.toggle('is-on', b === btn));
  renderStateGroup();
}
function renderStateGroup() {
  const label = document.getElementById('stateLabel');
  const group = document.getElementById('stateGroup');
  if (curScreen === 'profile') {
    label.textContent = 'История';
    group.innerHTML = `
      <button class="ss-btn ${histState==='list'?'is-on':''}" onclick="setHist('list',this)">Список</button>
      <button class="ss-btn ${histState==='empty'?'is-on':''}" onclick="setHist('empty',this)">Пусто</button>`;
  } else {
    label.textContent = 'АТЗ';
    group.innerHTML = `
      <button class="ss-btn ${atzState==='multi'?'is-on':''}" onclick="setAtz('multi',this)">Несколько</button>
      <button class="ss-btn ${atzState==='single'?'is-on':''}" onclick="setAtz('single',this)">Один</button>`;
  }
}
function setHist(s, btn) { histState = s; renderHistory(); document.querySelectorAll('#stateGroup .ss-btn').forEach(b=>b.classList.toggle('is-on', b===btn)); }
function setAtz(s, btn) { atzState = s; selAtz = 0; renderAtzList(); document.querySelectorAll('#stateGroup .ss-btn').forEach(b=>b.classList.toggle('is-on', b===btn)); }

/* init */
renderHistory();
renderAtzList();
renderStateGroup();
