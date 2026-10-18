/**
 * Демо-режим для записи видео/скриншотов: на экране госномера и ФИО заменяются
 * правдоподобными вымышленными (детерминированно — одна машина везде выглядит одинаково).
 * Данные и запросы не меняются: маскируется только видимый текст и title.
 * Включить: ?demo=1 (запоминается), выключить: ?demo=0.
 * Копия этого файла — в kip/client/src/lib/demoMask.ts (отдельный бандл iframe КИП).
 */

const RU = 'АВЕКМНОРСТУХ';
const LAT = 'ABEKMHOPCTYX'; // латинские двойники — в данных TIS встречаются
const L = `[${RU}${LAT}]`;
// Обычный номер (А016ОЕ172) и номер спецтехники (0023ОА72); не внутри слов и чисел.
const PLATE = new RegExp(`(?<![\\dА-ЯЁA-Z])${L}\\d{3}${L}{2}(\\d{2,3})(?!\\d)`, 'g');
const SPEC = new RegExp(`(?<![\\dА-ЯЁA-Z])\\d{4}${L}{2}(\\d{2,3})(?!\\d)`, 'g');
// ФИО из трёх слов с отчеством.
const FIO = /(?<![А-ЯЁа-яё])[А-ЯЁ][а-яё]+ [А-ЯЁ][а-яё]+ [А-ЯЁ][а-яё]+(?:вич|вна|ична|чна|ич)(?![а-яё])/g;
const SURNAMES = ['Иванов', 'Петров', 'Смирнов', 'Кузнецов', 'Соколов', 'Попов', 'Лебедев', 'Козлов', 'Новиков', 'Морозов', 'Волков', 'Зайцев'];
const NAMES = ['Алексей', 'Иван', 'Сергей', 'Дмитрий', 'Андрей', 'Павел', 'Олег', 'Николай'];
const PATRONYMICS = ['Петрович', 'Сергеевич', 'Иванович', 'Алексеевич', 'Викторович', 'Андреевич'];

const produced = new Set<string>(); // наши же маски не маскируем повторно

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function fake(src: string, region: string, spec: boolean): string {
  let h = hash(src);
  const letter = () => { const c = RU[h % RU.length]; h = Math.imul(h ^ 0x9e3779b9, 2654435761) >>> 0; return c; };
  const digit = () => { const d = h % 10; h = Math.imul(h ^ 0x85ebca6b, 2246822519) >>> 0; return String(d); };
  let out = spec
    ? `${digit()}${digit()}${digit()}${digit()}${letter()}${letter()}${region}`
    : `${letter()}${digit()}${digit()}${digit()}${letter()}${letter()}${region}`;
  if (out.replace(/[^\d]/g, '').startsWith('000')) out = out.replace('0', '7');
  produced.add(out);
  return out;
}

export function maskText(text: string): string {
  return text
    .replace(PLATE, (m, region: string) => (produced.has(m) ? m : fake(m, region, false)))
    .replace(SPEC, (m, region: string) => (produced.has(m) ? m : fake(m, region, true)))
    .replace(FIO, m => {
      if (produced.has(m)) return m;
      const h = hash(m);
      const out = `${SURNAMES[h % SURNAMES.length]} ${NAMES[(h >>> 4) % NAMES.length]} ${PATRONYMICS[(h >>> 8) % PATRONYMICS.length]}`;
      produced.add(out);
      return out;
    });
}

export function isDemoMode(): boolean {
  try {
    const q = new URLSearchParams(window.location.search).get('demo');
    if (q === '1') localStorage.setItem('lk.demo', '1');
    if (q === '0') localStorage.removeItem('lk.demo');
    return localStorage.getItem('lk.demo') === '1';
  } catch { return false; }
}

const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT']);

function maskNode(node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const p = node.parentElement;
    if (p && SKIP.has(p.tagName)) return;
    const v = node.nodeValue ?? '';
    const m = maskText(v);
    if (m !== v) node.nodeValue = m;
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  if (SKIP.has(el.tagName)) return;
  const t = el.getAttribute('title');
  if (t) { const m = maskText(t); if (m !== t) el.setAttribute('title', m); }
  el.childNodes.forEach(maskNode);
}

/** Маскирует текущий DOM и всё, что React дорисует позже. */
export function installDemoMask(root: Node = document.body): void {
  maskNode(root);
  new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'characterData') maskNode(r.target);
      else if (r.type === 'attributes') maskNode(r.target);
      else r.addedNodes.forEach(maskNode);
    }
  }).observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title'] });
}
