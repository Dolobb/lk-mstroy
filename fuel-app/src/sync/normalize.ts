/**
 * Нормализация госномера для офлайн-поиска ТС: верхний регистр, без пробелов/дефисов,
 * только буквы (лат+кир) и цифры. Хранится в `vehicles.gosNumberNorm`; запрос нормализуется так же.
 * LIKE по индексированному нормализованному столбцу — быстро на ~2 тыс. ТС (FTS5 избыточен).
 */
export function normalizeGosNumber(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-ZА-ЯЁ]/g, "");
}
