// node frontend/src/lib/demoMask.check.mjs — самопроверка маскировки (без фреймворка).
import assert from 'node:assert/strict';
import { maskText } from './demoMask.ts';

// детерминизм и сохранение формата/региона
const a = maskText('А016ОЕ172');
assert.equal(a, maskText('А016ОЕ172'), 'тот же номер → та же маска');
assert.notEqual(a, 'А016ОЕ172', 'номер замаскирован');
assert.match(a, /^[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}172$/, 'формат и регион сохранены');
assert.match(maskText('0023ОА72'), /^\d{4}[АВЕКМНОРСТУХ]{2}72$/, 'номер спецтехники');
assert.notEqual(maskText('0023ОА72'), '0023ОА72');
// латинские двойники букв тоже ловятся
assert.notEqual(maskText('A016OE172'), 'A016OE172');
// маска не маскируется повторно (иначе MutationObserver зациклится)
assert.equal(maskText(a), a, 'идемпотентность');
// в тексте
assert.match(maskText('ТС А016ОЕ172 на объекте'), /^ТС [АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}172 на объекте$/);
// не номера — не трогаем
for (const s of ['Заявка #142025', 'Р-404 Тюмень — Тобольск', '71Н-1603', '17.10 07:30', 'КИП 68%', '2026-10-18', 'МО-36']) {
  assert.equal(maskText(s), s, `не номер: ${s}`);
}
// ФИО → вымышленное, детерминированно
const f = maskText('Грудцын Максим Евгеньевич');
assert.notEqual(f, 'Грудцын Максим Евгеньевич');
assert.equal(f, maskText('Грудцын Максим Евгеньевич'));
assert.equal(maskText(f), f, 'ФИО-маска идемпотентна');
assert.equal(maskText('Тест Водитель'), 'Тест Водитель', 'два слова без отчества не трогаем');
console.log('demoMask: OK');
