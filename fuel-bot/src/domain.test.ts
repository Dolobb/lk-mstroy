/**
 * Тесты доменной логики. Запуск: npm test
 *
 * Telegram здесь не участвует — проверяются именно правила. Половина тестов
 * стоит на разборе введённого объёма: в боевом приложении одно неверное
 * значение однажды уронило целый пакет синхронизации.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";

const { parseLiters, parseRecipient, round2, MAX_LITERS, openShift, dispense, receive, closeShift, currentRemaining } =
  await import("./domain.ts");
const { seed, listAtz, findDriverByPin, findOpenShift, searchVehicles } = await import("./db.ts");

seed();

const driver = findDriverByPin("1234")!;
const atzId = listAtz()[0]!.id;

// ── Разбор объёма ────────────────────────────────────────────────────────────

test("принимает целое и дробное, точку и запятую", () => {
  assert.deepEqual(parseLiters("120"), { ok: true, value: 120 });
  assert.deepEqual(parseLiters("120.5"), { ok: true, value: 120.5 });
  assert.deepEqual(parseLiters("120,50"), { ok: true, value: 120.5 });
  assert.deepEqual(parseLiters("  80  "), { ok: true, value: 80 });
});

test("отклоняет ноль и отрицательные", () => {
  assert.equal(parseLiters("0").ok, false);
  assert.equal(parseLiters("-5").ok, false);
});

test("отклоняет мусор и три знака после точки", () => {
  assert.equal(parseLiters("сто").ok, false);
  assert.equal(parseLiters("").ok, false);
  assert.equal(parseLiters("12.345").ok, false);
  assert.equal(parseLiters("1e5").ok, false);
});

test("отклоняет значение выше предела", () => {
  assert.equal(parseLiters(String(MAX_LITERS)).ok, true);
  assert.equal(parseLiters("100000").ok, false);
});

test("имя получателя: минимум два символа, схлопывает пробелы", () => {
  assert.equal(parseRecipient("П").ok, false);
  assert.deepEqual(parseRecipient("  Петров   П.П.  "), { ok: true, value: "Петров П.П." });
  assert.equal(parseRecipient("x".repeat(81)).ok, false);
});

test("round2 не копит хвосты с плавающей точкой", () => {
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(1000 - 333.33), 666.67);
});

// ── Смена ────────────────────────────────────────────────────────────────────

test("смена открывается и учитывает выдачи и приёмки", () => {
  const opened = openShift(driver.id, atzId, 1000);
  assert.equal(opened.ok, true);
  const shift = (opened as { ok: true; value: any }).value;

  assert.equal(currentRemaining(shift), 1000);

  const veh = searchVehicles("Е701")[0]!;
  const d = dispense(shift, veh.id, 250.5, "Петров П.П.");
  assert.equal(d.ok, true);
  assert.equal(currentRemaining(shift), 749.5);

  const r = receive(shift, 100);
  assert.equal(r.ok, true);
  assert.equal(currentRemaining(shift), 849.5);
});

test("нельзя выдать больше, чем есть в цистерне", () => {
  const shift = findOpenShift(driver.id)!;
  const veh = searchVehicles("Е702")[0]!;
  const before = currentRemaining(shift);

  const res = dispense(shift, veh.id, before + 1, "Сидоров С.С.");
  assert.equal(res.ok, false);
  assert.equal(currentRemaining(shift), before, "неудачная выдача не меняет остаток");
});

test("на один АТЗ нельзя открыть вторую смену", () => {
  const second = openShift(driver.id, atzId, 500);
  assert.equal(second.ok, false);
});

test("закрытие фиксирует остаток и запрещает повторное закрытие", () => {
  const shift = findOpenShift(driver.id)!;
  const expected = currentRemaining(shift);

  const closed = closeShift(shift);
  assert.equal(closed.ok, true);
  assert.equal((closed as { ok: true; value: any }).value.closing, expected);

  assert.equal(findOpenShift(driver.id), null);
  assert.equal(closeShift(shift).ok, false);
});

// ── Поиск ────────────────────────────────────────────────────────────────────

test("поиск ТС не зависит от регистра и пробелов", () => {
  assert.ok(searchVehicles("е701").length > 0);
  assert.ok(searchVehicles("Е 701").length > 0);
  assert.equal(searchVehicles("ZZZZZ").length, 0);
});

// ── Защита от повторной записи в закрытую смену ──────────────────────────────

test("в закрытую смену нельзя ни выдать, ни принять", () => {
  const stale = openShift(driver.id, listAtz()[1]!.id, 800);
  assert.equal(stale.ok, true);
  const shift = (stale as { ok: true; value: any }).value;

  assert.equal(closeShift(shift).ok, true);

  // Объект `shift` в памяти всё ещё считает себя открытым — операции должны
  // опираться на состояние в базе, а не на него.
  const veh = searchVehicles("Х330")[0]!;
  assert.equal(dispense(shift, veh.id, 10, "Петров П.П.").ok, false);
  assert.equal(receive(shift, 10).ok, false);
});
