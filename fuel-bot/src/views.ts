/**
 * Тексты сообщений и сборка главного меню.
 * Отделены от логики, чтобы формулировки правились в одном месте.
 */
import type { Context } from "grammy";
import { findOpenShift, getAtz, listAtz, listDispenses, shiftTotals, type Driver } from "./db.ts";
import { currentRemaining, formatLiters } from "./domain.ts";
import { menuInShift, menuNoShift } from "./keyboards.ts";

export const WELCOME = [
  "⛽ *Выдача топлива* — демо",
  "",
  "Бот повторяет рабочий день водителя топливозаправщика:",
  "открыть смену → выдавать топливо машинам → закрыть смену.",
  "Все данные учебные, ничего настоящего не меняется.",
  "",
  "🔑 Тестовый PIN: `1234`",
  "",
  "Отправьте его сообщением — нажмите на код, чтобы скопировать."
].join("\n");

export function profileText(driver: Driver): string {
  const shift = findOpenShift(driver.id);
  const lines = [`👤 *${driver.full_name}*`, `Логин: \`${driver.login}\``, ""];
  if (shift) {
    const atz = getAtz(shift.atz_id);
    lines.push(`Смена открыта по ${atz?.gos_number ?? "—"}`, `Начата: ${time(shift.started_at)}`);
  } else {
    lines.push("Открытых смен нет.");
  }
  return lines.join("\n");
}

export function statusText(driverId: string): string {
  const shift = findOpenShift(driverId);
  if (!shift) return "Смена не открыта.";
  const atz = getAtz(shift.atz_id);
  const { dispensed, received, count } = shiftTotals(shift.id);
  return [
    `📊 *Смена по ${atz?.gos_number ?? "—"}*`,
    "",
    `Остаток в цистерне: *${formatLiters(currentRemaining(shift))} л*`,
    "",
    `На старте: ${formatLiters(shift.opening_remaining_liters)} л`,
    `Выдано: ${formatLiters(dispensed)} л (${count} опер.)`,
    `Принято: ${formatLiters(received)} л`,
    `Начата: ${time(shift.started_at)}`
  ].join("\n");
}

export function historyText(driverId: string): string {
  const shift = findOpenShift(driverId);
  if (!shift) return "Смена не открыта.";
  const rows = listDispenses(shift.id);
  if (rows.length === 0) return "📖 За смену пока ничего не выдано.";
  const lines = rows.map(
    (r) => `${time(r.happened_at)} · *${formatLiters(r.liters)} л* → ${r.gos_number} · ${r.recipient_name}`
  );
  return ["📖 *Последние выдачи*", "", ...lines].join("\n");
}

/** Показывает главное меню — состав кнопок зависит от того, открыта ли смена. */
export async function showMenu(ctx: Context, driver: Driver, note?: string): Promise<void> {
  const shift = findOpenShift(driver.id);
  let text: string;
  let keyboard;

  if (shift) {
    const atz = getAtz(shift.atz_id);
    text = [
      `⛽ *Смена открыта* · ${atz?.gos_number ?? "—"}`,
      `Остаток: *${formatLiters(currentRemaining(shift))} л*`
    ].join("\n");
    keyboard = menuInShift();
  } else {
    text = [
      "Смена не открыта.",
      "",
      "Порядок такой: открыть смену на заправщике → выдавать топливо машинам → закрыть смену со сводкой."
    ].join("\n");
    keyboard = menuNoShift(listAtz().length);
  }

  if (note) text = `${note}\n\n${text}`;

  await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
}

function time(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
