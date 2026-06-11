/* ============================================================
   Выдача топлива — спина: навигация, PIN, смена, журнал
   ============================================================ */

/* ── Tablet scaling to viewport ───────────────────────── */
function scaleTablet() {
  const t = document.getElementById('tablet');
  if (!t) return;
  const pad = 32;
  const s = Math.min((innerWidth - pad) / 1280, (innerHeight - pad) / 800, 1);
  t.style.transform = `scale(${s})`;
}
addEventListener('resize', scaleTablet);
addEventListener('load', scaleTablet);
scaleTablet();

/* ── Inject vehicle icons ─────────────────────────────── */
document.getElementById('lb-atz-ico').innerHTML = VEH.semiTruck;
document.getElementById('home-atz-ico').innerHTML = VEH.semiTruck;

/* ── Screen switching ─────────────────────────────────── */
function show(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('is-active', v.dataset.view === view));
  document.querySelector('.screen-body, .view.is-active')?.scrollTo?.(0, 0);
}

/* ── State ────────────────────────────────────────────── */
const state = {
  remain: 8420,
  given: 0,
  ops: 0,
  queued: 2,
  shiftStart: null,
  log: [],
};

/* ── PIN login ────────────────────────────────────────── */
let pin = '';
const PIN_OK = '1234';
function renderPin() {
  const dots = document.querySelectorAll('#pinDots .pd');
  dots.forEach((d, i) => { d.classList.toggle('filled', i < pin.length); d.classList.remove('err'); });
}
document.getElementById('loginKeypad').addEventListener('click', (e) => {
  const k = e.target.closest('.key'); if (!k) return;
  const v = k.dataset.k;
  document.getElementById('pinErr').textContent = '';
  if (v === 'del') { pin = pin.slice(0, -1); renderPin(); return; }
  if (v === 'switch') { document.getElementById('pinErr').textContent = 'Выбор заправщика — следующая итерация'; return; }
  if (pin.length >= 4) return;
  pin += v; renderPin();
  if (pin.length === 4) setTimeout(checkPin, 180);
});
function checkPin() {
  if (pin === PIN_OK) {
    show('home');
  } else {
    document.querySelectorAll('#pinDots .pd').forEach(d => d.classList.add('err'));
    document.getElementById('pinErr').textContent = 'Неверный PIN. Попробуйте ещё раз';
    setTimeout(() => { pin = ''; renderPin(); }, 600);
  }
}
// hint for prototype
document.getElementById('pinErr').textContent = '';

/* ── Past shifts ──────────────────────────────────────── */
const SHIFTS = [
  { date: '11.05.2026', shift: 'С1', time: '08:02 — 17:40', ts: 11, given: 4120 },
  { date: '10.05.2026', shift: 'С1', time: '07:58 — 18:05', ts: 14, given: 5360 },
  { date: '08.05.2026', shift: 'С2', time: '19:55 — 04:30', ts: 7, given: 2840 },
  { date: '07.05.2026', shift: 'С1', time: '08:10 — 17:20', ts: 9, given: 3510 },
];
function renderShifts() {
  document.getElementById('shiftList').innerHTML = SHIFTS.map(s => `
    <div class="shift-card">
      <div class="row" style="justify-content:space-between;align-items:baseline">
        <span class="t-body-strong">${s.date}</span>
        <span class="t-caption" style="font-weight:600">${s.shift} · ${s.time}</span>
      </div>
      <div class="sc-stats">
        <div class="sc-stat"><span class="t-label">ТС</span><span class="t-heading">${s.ts}</span></div>
        <div class="sc-stat"><span class="t-label">Выдано</span><span class="t-heading">${s.given.toLocaleString('ru')} л</span></div>
      </div>
    </div>`).join('');
}
renderShifts();

/* ── Shift lifecycle ──────────────────────────────────── */
let timerId = null;
function startShift() {
  state.shiftStart = Date.now();
  show('work');
  tickTimer();
  timerId = setInterval(tickTimer, 1000);
  renderLog();
}
function tickTimer() {
  const el = document.getElementById('shiftTimer');
  if (!el || !state.shiftStart) return;
  let s = Math.floor((Date.now() - state.shiftStart) / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  el.textContent = `${h}:${m}:${sec}`;
}
function endShift() {
  if (!confirm('Закрыть смену? Несинхронизированные записи отправятся при появлении связи.')) return;
  clearInterval(timerId);
  state.shiftStart = null;
  pin = ''; renderPin();
  show('login');
}

/* ── Manual sync (offline → syncing → synced) ─────────── */
function manualSync() {
  const pill = document.getElementById('workSync');
  pill.className = 'sync-pill is-syncing';
  pill.innerHTML = '<span class="dot"></span>Синхронизация…';
  setTimeout(() => {
    state.queued = 0;
    pill.className = 'sync-pill is-synced';
    pill.innerHTML = '<span class="dot"></span>Синхронизировано';
    document.querySelectorAll('.chip-queued').forEach(c => c.remove());
  }, 1600);
}

/* ── Give fuel (demo: append a record) ────────────────── */
const DEMO_GIVE = [
  { plate: 'М 902 ОР 28', model: 'Экскаватор Caterpillar 329', icon: 'excavator', liters: 320 },
  { plate: 'А 145 КН 138', model: 'Самосвал КАМАЗ 6520', icon: 'dumpTruck', liters: 540 },
  { plate: 'К 771 ТС 138', model: 'Бульдозер ЧЕТРА Т-11', icon: 'heavy', liters: 410 },
];
function goGive() {
  // В этой итерации передача симулируется: добавляем следующую запись из демо-набора.
  const rec = DEMO_GIVE[state.ops % DEMO_GIVE.length];
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  state.log.unshift({ ...rec, time: `${hh}:${mm}`, queued: true });
  state.ops += 1;
  state.given += rec.liters;
  state.remain -= rec.liters;
  state.queued += 1;
  syncSummary();
  renderLog();
}
function syncSummary() {
  document.getElementById('remainNum').textContent = state.remain.toLocaleString('ru');
  document.getElementById('givenTotal').textContent = state.given.toLocaleString('ru') + ' л';
  document.getElementById('opCount').textContent = state.ops;
  document.getElementById('qCount').textContent = state.queued;
  const pill = document.getElementById('workSync');
  if (state.queued > 0 && !pill.classList.contains('is-syncing')) {
    pill.className = 'sync-pill is-offline';
    pill.innerHTML = `<span class="dot"></span>Офлайн · <span id="qCount">${state.queued}</span> в очереди`;
  }
}
function renderLog() {
  const wrap = document.getElementById('logScroll');
  if (state.log.length === 0) {
    wrap.innerHTML = `<div class="log-empty" id="logEmpty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 5h16M4 12h16M4 19h10"/></svg>
      <div class="t-body" style="color:var(--ink-3)">Записей пока нет</div>
      <div class="t-caption">Нажмите «Передача топлива», чтобы выдать топливо технике</div>
    </div>`;
    return;
  }
  wrap.innerHTML = state.log.map((r, i) => `
    <div class="fuel-row fuel-row--give">
      <div class="fr-mark"></div>
      <div class="fr-icon">${VEH[r.icon]}</div>
      <div class="fr-main">
        <span class="t-body-strong" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${r.plate} ${r.queued ? '<span class="chip-queued"><span class="dot"></span>в очереди</span>' : ''}</span>
        <span class="t-caption">${r.model} · ${r.time}</span>
      </div>
      <span class="fr-liters">${r.liters} л</span>
      <button class="fr-edit" onclick="editRec(${i})" title="Редактировать">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
      </button>
    </div>`).join('');
}
function editRec(i) {
  alert('Экран «Редактирование записи» (нижний лист) — следующая итерация');
}
