/* ============================================================
   Схема потока — раскладка узлов + SVG-коннекторы
   ============================================================ */

const NODES = {
  '0': { x:40,   y:372, w:240, h:120, n:'0', title:'Вход',            sub:'Логин + PIN · офлайн-вход', kind:'auth' },
  '1': { x:400,  y:296, w:240, h:120, n:'1', title:'Главный',         sub:'Смена не начата', kind:'primary' },
  '2': { x:400,  y:520, w:240, h:120, n:'2', title:'Профиль и история',sub:'Карточки прошлых смен', kind:'info' },
  '3': { x:760,  y:296, w:240, h:120, n:'3', title:'Старт смены',     sub:'Выбор АТЗ · остаток', kind:'primary' },
  '4': { x:1120, y:288, w:248, h:172, n:'4', title:'Рабочий режим',   sub:'Хаб смены · таймер · журнал · синк', kind:'hub' },
  '5': { x:1500, y:104, w:248, h:120, n:'5', title:'Передача топлива',sub:'Выбор ТС → литры', kind:'op' },
  '6': { x:1500, y:288, w:248, h:120, n:'6', title:'Добавление ТС',   sub:'Орг · тип · марка', kind:'op' },
  '7': { x:1500, y:472, w:248, h:120, n:'7', title:'Получение топлива',sub:'Литры + фото ТТН', kind:'op' },
  '8': { x:1500, y:656, w:248, h:120, n:'8', title:'Редактирование',  sub:'Нижний лист · мягкое удаление', kind:'op' },
  '9': { x:1120, y:600, w:248, h:120, n:'9', title:'Закрытие смены',  sub:'Сводка · итоговый остаток', kind:'terminal' },
};

const CONNS = [
  { from:'0', to:'1', fs:'r', ts:'l', type:'fwd' },
  { from:'1', to:'3', fs:'r', ts:'l', type:'fwd', label:'Начать смену' },
  { from:'1', to:'2', fs:'b', ts:'t', type:'bi',  label:'Профиль' },
  { from:'3', to:'4', fs:'r', ts:'l', type:'fwd' },
  { from:'4', to:'5', fs:'r', ts:'l', type:'bi',  label:'Передача', foy:-52 },
  { from:'4', to:'6', fs:'r', ts:'l', type:'bi',  label:'', foy:-12 },
  { from:'4', to:'7', fs:'r', ts:'l', type:'bi',  label:'Получение', foy:20 },
  { from:'4', to:'8', fs:'r', ts:'l', type:'bi',  label:'Правка', foy:52 },
  { from:'5', to:'6', fs:'b', ts:'t', type:'bi',  label:'+ Добавить ТС' },
  { from:'4', to:'9', fs:'b', ts:'t', type:'fwd', label:'Закрыть смену' },
  { from:'9', to:'0', fs:'b', ts:'b', type:'return', label:'Смена закрыта → выход' },
];

function anchor(node, side, off = 0) {
  const { x, y, w, h } = node;
  switch (side) {
    case 'l': return { x, y: y + h/2 + off };
    case 'r': return { x: x + w, y: y + h/2 + off };
    case 't': return { x: x + w/2 + off, y };
    case 'b': return { x: x + w/2 + off, y: y + h };
  }
}

function buildSVG() {
  const svg = document.getElementById('wires');
  let paths = '';
  CONNS.forEach((c, i) => {
    const A = NODES[c.from], B = NODES[c.to];
    const p1 = anchor(A, c.fs, c.foy || 0);
    const p2 = anchor(B, c.ts, c.toy || 0);
    let d;
    if (c.type === 'return') {
      // orthogonal route along the bottom
      const yLane = 812;
      d = `M ${p1.x} ${p1.y} V ${yLane} H ${p2.x} V ${p2.y}`;
    } else if (c.fs === 'r' && c.ts === 'l') {
      // smooth horizontal cubic
      const dx = (p2.x - p1.x) * 0.5;
      d = `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${p2.x - dx} ${p2.y}, ${p2.x} ${p2.y}`;
    } else if (c.fs === 'b' && c.ts === 't') {
      const dy = (p2.y - p1.y) * 0.5;
      d = `M ${p1.x} ${p1.y} C ${p1.x} ${p1.y + dy}, ${p2.x} ${p2.y - dy}, ${p2.x} ${p2.y}`;
    } else {
      d = `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
    }
    const cls = c.type === 'return' ? 'wire wire--return' : (c.type === 'bi' ? 'wire wire--bi' : 'wire wire--fwd');
    const markEnd = c.type === 'return' ? 'url(#ahGrey)' : 'url(#ahLav)';
    const markStart = c.type === 'bi' ? 'url(#ahLavStart)' : '';
    paths += `<path d="${d}" class="${cls}" marker-end="${markEnd}" ${markStart ? `marker-start="${markStart}"` : ''} fill="none"/>`;
    // label
    if (c.label) {
      let lx, ly;
      if (c.type === 'return') { lx = (p1.x + p2.x) / 2; ly = 812; }
      else if (c.fs === 'r') { lx = (p1.x + p2.x) / 2; ly = (p1.y + p2.y) / 2 - 10; }
      else { lx = (p1.x + p2.x) / 2 + 12; ly = (p1.y + p2.y) / 2; }
      paths += `<g class="wire-label" data-x="${lx}" data-y="${ly}"></g>`;
    }
  });
  svg.innerHTML = `
    <defs>
      <marker id="ahLav" markerWidth="11" markerHeight="11" refX="8" refY="5.5" orient="auto"><path d="M1 1 L9 5.5 L1 10" fill="none" stroke="#5e6ad2" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></marker>
      <marker id="ahLavStart" markerWidth="11" markerHeight="11" refX="3" refY="5.5" orient="auto"><path d="M9 1 L1 5.5 L9 10" fill="none" stroke="#5e6ad2" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></marker>
      <marker id="ahGrey" markerWidth="11" markerHeight="11" refX="8" refY="5.5" orient="auto"><path d="M1 1 L9 5.5 L1 10" fill="none" stroke="#8a8f98" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></marker>
    </defs>${paths}`;
}

function buildLabels() {
  const layer = document.getElementById('labels');
  let html = '';
  CONNS.forEach(c => {
    if (!c.label) return;
    const A = NODES[c.from], B = NODES[c.to];
    const p1 = anchor(A, c.fs, c.foy || 0);
    const p2 = anchor(B, c.ts, c.toy || 0);
    let lx, ly;
    if (c.type === 'return') { lx = (p1.x + p2.x) / 2; ly = 812; }
    else if (c.fs === 'r') { lx = (p1.x + p2.x) / 2; ly = (p1.y + p2.y) / 2 - 14; }
    else { lx = (p1.x + p2.x) / 2; ly = (p1.y + p2.y) / 2; }
    html += `<span class="conn-label" style="left:${lx}px;top:${ly}px">${c.label}</span>`;
  });
  layer.innerHTML = html;
}

function buildNodes() {
  const layer = document.getElementById('nodes');
  layer.innerHTML = Object.values(NODES).map(n => `
    <div class="fnode fnode--${n.kind}" style="left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px">
      <div class="fn-top">
        <span class="fn-num">${n.n}</span>
        <span class="fn-kind">${kindLabel(n.kind)}</span>
      </div>
      <div class="fn-title">${n.title}</div>
      <div class="fn-sub">${n.sub}</div>
    </div>`).join('');
}
function kindLabel(k) {
  return { auth:'Доступ', primary:'Действие', info:'Просмотр', hub:'Хаб смены', op:'Операция', terminal:'Завершение' }[k] || '';
}

function scaleMap() {
  const stage = document.getElementById('mapStage');
  const map = document.getElementById('map');
  const W = 1788, H = 856;
  const pad = 48;
  const s = Math.min((stage.clientWidth - pad) / W, (stage.clientHeight - pad) / H, 1);
  map.style.transform = `translate(-50%, -50%) scale(${s})`;
}

buildNodes();
buildSVG();
buildLabels();
addEventListener('resize', scaleMap);
addEventListener('load', scaleMap);
scaleMap();
