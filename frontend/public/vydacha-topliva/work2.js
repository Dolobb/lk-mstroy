/* ============================================================
   Получение · Редактирование · Закрытие
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

const ATZ_REMAIN = 7150;

/* ── Journal (mix give + receive, one queued) ─────────── */
let LOG = [
  { id:1, kind:'give', plate:'А 145 КН 138', type:'dumpTruck', model:'Самосвал КАМАЗ 6520', org:'НПС Спецтехника', liters:540, time:'09:14', queued:false },
  { id:2, kind:'give', plate:'М 902 ОР 28', type:'excavator', model:'Экскаватор Caterpillar 329', org:'НПС Карьер', liters:320, time:'10:02', queued:true },
  { id:3, kind:'give', plate:'К 771 ТС 138', type:'heavy', model:'Бульдозер ЧЕТРА Т-11', org:'НПС Спецтехника', liters:410, time:'11:21', queued:true },
];

const editIco = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;

function renderLog() {
  document.getElementById('logScroll').innerHTML = LOG.map(r => {
    const isRecv = r.kind === 'receive';
    return `<div class="fuel-row ${isRecv ? 'fuel-row--receive' : 'fuel-row--give'}">
      <div class="fr-mark"></div>
      <div class="fr-icon">${isRecv ? recvBadge() : VEH[r.type]}</div>
      <div class="fr-main">
        <span class="t-body-strong" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${isRecv ? 'Получение в АТЗ' : r.plate}
          ${r.queued ? '<span class="chip-queued"><span class="dot"></span>в очереди</span>' : ''}
        </span>
        <span class="t-caption">${isRecv ? ('ТТН · ' + r.time) : (r.model + ' · ' + r.time)}</span>
      </div>
      <span class="fr-liters">${isRecv ? '+' : ''}${r.liters} л</span>
      <button class="fr-edit" onclick="openEdit(${r.id})" title="Редактировать">${editIco}</button>
    </div>`;
  }).join('');
}
function recvBadge() {
  return `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/></svg>`;
}
renderLog();

/* ── ПОЛУЧЕНИЕ ────────────────────────────────────────── */
let recvAmt = 0;
let hasPhoto = false;

function openRecv() { recvAmt = 0; hasPhoto = false; resetPhoto(); renderRecv(); show('recv'); }

function renderRecv() {
  const numEl = document.getElementById('recvNum');
  numEl.textContent = recvAmt.toLocaleString('ru');
  numEl.classList.toggle('is-empty', recvAmt === 0);
  document.getElementById('recvAfter').innerHTML = `Остаток после приёма: <span class="v">${(ATZ_REMAIN + recvAmt).toLocaleString('ru')} л</span>`;
  const btn = document.getElementById('recvConfirm');
  if (recvAmt === 0) { btn.disabled = true; btn.textContent = 'Введите объём'; }
  else { btn.disabled = false; btn.textContent = `Принять ${recvAmt.toLocaleString('ru')} л`; }
}
document.getElementById('recvKeypad').addEventListener('click', e => {
  const k = e.target.closest('.key'); if (!k) return;
  const v = k.dataset.k;
  if (v === 'clear') recvAmt = 0;
  else if (v === 'del') recvAmt = Math.floor(recvAmt / 10);
  else { if (String(recvAmt).length >= 5) return; recvAmt = recvAmt * 10 + Number(v); }
  renderRecv();
});

function attachPhoto() {
  hasPhoto = true;
  document.getElementById('ttnDrop').classList.add('hide');
  document.getElementById('ttnPreview').classList.add('show');
  // simulate offline queued, then "uploaded" after sync moment
  setStatus('queued', 'В очереди на загрузку (офлайн)');
}
function setStatus(kind, text) {
  const el = document.getElementById('ttnStatus');
  el.className = 'ttn-status ' + kind;
  document.getElementById('ttnStatusText').textContent = text;
  el.querySelector('.s-ico').innerHTML = kind === 'ok'
    ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
    : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6v6l4 2"/><circle cx="12" cy="12" r="9"/></svg>';
}
function removePhoto() { hasPhoto = false; resetPhoto(); }
function resetPhoto() {
  document.getElementById('ttnDrop').classList.remove('hide');
  document.getElementById('ttnPreview').classList.remove('show');
}
function confirmRecv() {
  LOG.unshift({ id: Date.now(), kind:'receive', liters: recvAmt, time: nowHM(), queued: true, hasPhoto });
  renderLog();
  showToast(`Принято ${recvAmt.toLocaleString('ru')} л в АТЗ`);
  document.getElementById('recvTotal').textContent = recvAmt.toLocaleString('ru') + ' л';
  document.getElementById('remainNum').textContent = (ATZ_REMAIN + recvAmt).toLocaleString('ru');
  document.getElementById('opCount').textContent = LOG.length;
  setTimeout(() => show('work'), 500);
}
function nowHM() {
  const d = new Date();
  return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}

/* ── РЕДАКТИРОВАНИЕ (bottom sheet) ────────────────────── */
let editId = null;
let editLiters = 0;

function openEdit(id) {
  const r = LOG.find(x => x.id === id); if (!r) return;
  if (r.kind === 'receive') { showToast('Редактирование получения — литры/фото ТТН'); }
  editId = id; editLiters = r.liters;
  document.getElementById('edIcon').innerHTML = r.kind === 'receive' ? recvBadge() : VEH[r.type];
  document.getElementById('edPlate').textContent = r.kind === 'receive' ? 'Получение в АТЗ' : r.plate;
  document.getElementById('edMeta').textContent = r.kind === 'receive' ? ('ТТН · ' + r.time) : (r.model + ' · ' + r.time);
  document.getElementById('edChangePlate').textContent = r.kind === 'receive' ? 'АТЗ Х 214 ТТ 138' : r.plate;
  document.getElementById('edLiters').textContent = editLiters.toLocaleString('ru');
  // reset to main panel
  document.getElementById('esMain').classList.remove('hide');
  document.getElementById('esConfirmDel').classList.remove('show');
  document.getElementById('editOverlay').classList.add('show');
}
function stepEd(d) { editLiters = Math.max(0, editLiters + d); document.getElementById('edLiters').textContent = editLiters.toLocaleString('ru'); }
function closeEdit() { document.getElementById('editOverlay').classList.remove('show'); }
function saveEdit() {
  const r = LOG.find(x => x.id === editId); if (r) { r.liters = editLiters; r.queued = true; }
  renderLog(); closeEdit(); showToast('Запись обновлена');
}
function askDelete() {
  const r = LOG.find(x => x.id === editId);
  document.getElementById('delPlate').textContent = r.kind === 'receive' ? 'Получение в АТЗ' : r.plate;
  document.getElementById('esMain').classList.add('hide');
  document.getElementById('esConfirmDel').classList.add('show');
}
function cancelDelete() {
  document.getElementById('esMain').classList.remove('hide');
  document.getElementById('esConfirmDel').classList.remove('show');
}
function confirmDelete() {
  LOG = LOG.filter(x => x.id !== editId);
  renderLog(); closeEdit(); showToast('Запись удалена');
  document.getElementById('opCount').textContent = LOG.length;
}

/* ── ЗАКРЫТИЕ СМЕНЫ ───────────────────────────────────── */
function openClose() { document.getElementById('closeOverlay').classList.add('show'); }
function closeCloseModal() { document.getElementById('closeOverlay').classList.remove('show'); }
function confirmClose() { closeCloseModal(); showToast('Смена закрыта · записи отправятся при связи'); }

/* ── Toast ────────────────────────────────────────────── */
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
