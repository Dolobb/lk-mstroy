/**
 * Inline-клавиатуры.
 *
 * Каждая кнопка несёт callback_data — короткую строку, которая приходит боту
 * при нажатии. Формат: "действие:аргумент". Разбирается в handlers/router.ts.
 * Telegram ограничивает callback_data 64 байтами, поэтому передаём id, а не
 * человекочитаемые названия.
 */
import { InlineKeyboard } from "grammy";
import type { Atz, Vehicle } from "./db.ts";

/** Меню, когда смена не открыта. */
export function menuNoShift(_atzCount: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("🚛 Начать смену", "shift:start")
    .row()
    .text("👤 Профиль", "nav:profile")
    .text("🚪 Выйти", "auth:logout");
}

/** Меню, когда смена открыта. */
export function menuInShift(): InlineKeyboard {
  return new InlineKeyboard()
    .text("⛽ Выдать топливо", "dispense:begin")
    .row()
    .text("📥 Принять топливо", "receipt:begin")
    .row()
    .text("📊 Остаток и сводка", "shift:status")
    .text("📖 История", "shift:history")
    .row()
    .text("🏁 Закрыть смену", "shift:close")
    .row()
    .text("👤 Профиль", "nav:profile");
}

/** Список АТЗ для старта смены. */
export function atzList(items: Atz[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const a of items) {
    kb.text(`${a.gos_number} · ${a.title ?? "АТЗ"}`, `shift:atz:${a.id}`).row();
  }
  return kb.text("← Назад", "nav:menu");
}

/** Результаты поиска ТС. */
export function vehicleList(items: Vehicle[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const v of items) {
    kb.text(`${v.gos_number} · ${v.mark ?? "—"}`, `dispense:veh:${v.id}`).row();
  }
  return kb.text("🔁 Искать заново", "dispense:begin").text("← Отмена", "nav:menu");
}

/** Подтверждение перед записью операции. Подпись кнопки задаётся под действие. */
export function confirm(yes: string, label = "✅ Записать", no = "nav:menu"): InlineKeyboard {
  return new InlineKeyboard().text(label, yes).text("✖️ Отмена", no);
}

export const backToMenu = new InlineKeyboard().text("← В меню", "nav:menu");
