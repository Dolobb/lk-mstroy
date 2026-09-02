/**
 * Нажатия inline-кнопок.
 *
 * Telegram присылает их как callback_query с полем data вида "действие:аргумент".
 * Здесь — ветвление по действию: это и есть «сценарии и ветвления» из ТЗ.
 *
 * Правило: на каждый callback обязательно отвечаем answerCallbackQuery(),
 * иначе у пользователя кнопка «залипает» с часиками.
 */
import type { Context } from "grammy";
import {
  findDriverByTgId,
  findOpenShift,
  getAtz,
  getVehicle,
  listAtz,
  unbindTg
} from "../db.ts";
import { closeShift, currentRemaining, dispense, formatLiters, receive } from "../domain.ts";
import { atzList, backToMenu, confirm } from "../keyboards.ts";
import { getSession, initial, resetStep } from "../session.ts";
import { historyText, profileText, showMenu, statusText, WELCOME } from "../views.ts";

export async function onCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  const tgId = ctx.from?.id;
  if (!data || !tgId) return;

  await ctx.answerCallbackQuery();

  const driver = findDriverByTgId(tgId);
  if (!driver) {
    await ctx.reply(WELCOME, { parse_mode: "Markdown" });
    getSession(tgId).step = { name: "await_pin" };
    return;
  }

  const session = getSession(tgId);
  const [action, sub, arg] = data.split(":");

  // ── Навигация ──────────────────────────────────────────────────────────────
  if (action === "nav") {
    resetStep(tgId);
    if (sub === "menu") return void (await showMenu(ctx, driver));
    if (sub === "profile") {
      return void (await ctx.reply(profileText(driver), { parse_mode: "Markdown", reply_markup: backToMenu }));
    }
  }

  // ── Выход ──────────────────────────────────────────────────────────────────
  if (action === "auth" && sub === "logout") {
    unbindTg(tgId);
    Object.assign(session, initial());
    session.step = { name: "await_pin" };
    return void (await ctx.reply("Вы вышли. Введите PIN, чтобы войти снова."));
  }

  // ── Смена ──────────────────────────────────────────────────────────────────
  if (action === "shift") {
    if (sub === "start") {
      if (findOpenShift(driver.id)) {
        return void (await showMenu(ctx, driver, "⚠️ Смена уже открыта."));
      }
      const items = listAtz();
      return void (await ctx.reply("Шаг 1 из 3. Выберите топливозаправщик, на котором работаете:", {
        reply_markup: atzList(items)
      }));
    }

    if (sub === "atz" && arg) {
      const atz = getAtz(arg);
      if (!atz) return void (await ctx.reply("Заправщик не найден.", { reply_markup: backToMenu }));
      session.step = { name: "await_opening_liters", atzId: atz.id };
      return void (await ctx.reply(
        [
          `Шаг 2 из 3. Заправщик *${atz.gos_number}*`,
          "",
          "В начале смены водитель сверяет остаток по счётчику на машине —",
          "он может отличаться от того, что записано в системе.",
          `По данным системы сейчас ${formatLiters(atz.remaining_liters)} л.`,
          "",
          "Введите фактический объём. Для демо подойдёт любое число, например `1000`."
        ].join("\n"),
        { parse_mode: "Markdown" }
      ));
    }

    if (sub === "status") {
      return void (await ctx.reply(statusText(driver.id), { parse_mode: "Markdown", reply_markup: backToMenu }));
    }

    if (sub === "history") {
      return void (await ctx.reply(historyText(driver.id), { parse_mode: "Markdown", reply_markup: backToMenu }));
    }

    if (sub === "close") {
      const shift = findOpenShift(driver.id);
      if (!shift) return void (await showMenu(ctx, driver, "Смена не открыта."));
      return void (await ctx.reply(
        [
          "🏁 *Закрыть смену?*",
          "",
          `Остаток на конец: *${formatLiters(currentRemaining(shift))} л*`,
          "После закрытия выдавать топливо будет нельзя.",
          "Смену можно открыть заново в любой момент."
        ].join("\n"),
        { parse_mode: "Markdown", reply_markup: confirm("shift:close_yes", "🏁 Закрыть смену") }
      ));
    }

    if (sub === "close_yes") {
      const shift = findOpenShift(driver.id);
      if (!shift) return void (await showMenu(ctx, driver, "Смена уже закрыта."));
      const res = closeShift(shift);
      if (!res.ok) return void (await showMenu(ctx, driver, `⚠️ ${res.error}`));
      const { closing, dispensed, count } = res.value;
      const word = count === 1 ? "выдачу" : count < 5 ? "выдачи" : "выдач";
      return void (await showMenu(
        ctx,
        driver,
        `✅ Смена закрыта.\nВыдано ${formatLiters(dispensed)} л за ${count} ${word}.\nОстаток в цистерне ${formatLiters(closing)} л.`
      ));
    }
  }

  // ── Выдача топлива ─────────────────────────────────────────────────────────
  if (action === "dispense") {
    const shift = findOpenShift(driver.id);
    if (!shift) return void (await showMenu(ctx, driver, "⚠️ Сначала откройте смену."));

    if (sub === "begin") {
      session.step = { name: "await_vehicle_query" };
      return void (await ctx.reply(
        [
          "Кому выдаём топливо? Найдите машину по госномеру —",
          "достаточно нескольких символов.",
          "",
          "Попробуйте `Е701`, `Х330` или `72`."
        ].join("\n"),
        { parse_mode: "Markdown" }
      ));
    }

    if (sub === "veh" && arg) {
      const vehicle = getVehicle(arg);
      if (!vehicle) return void (await ctx.reply("ТС не найдено.", { reply_markup: backToMenu }));
      session.step = { name: "await_dispense_liters", vehicleId: vehicle.id };
      return void (await ctx.reply(
        [
          `ТС *${vehicle.gos_number}* · ${vehicle.mark ?? "—"}`,
          `Организация: ${vehicle.org_name}`,
          `В цистерне: ${formatLiters(currentRemaining(shift))} л`,
          "",
          "Сколько литров выдаём?"
        ].join("\n"),
        { parse_mode: "Markdown" }
      ));
    }

    // Финальное подтверждение — данные лежат в шаге, а не в callback_data:
    // в 64 байта они бы не поместились.
    if (sub === "save") {
      if (session.step.name !== "confirm_dispense") {
        return void (await showMenu(ctx, driver, "Нечего записывать — начните заново."));
      }
      const { vehicleId, liters, recipient } = session.step;
      const res = dispense(shift, vehicleId, liters, recipient);
      resetStep(tgId);
      if (!res.ok) return void (await showMenu(ctx, driver, `⚠️ ${res.error}`));
      const vehicle = getVehicle(vehicleId);
      return void (await showMenu(
        ctx,
        driver,
        `✅ Выдано ${formatLiters(liters)} л → ${vehicle?.gos_number ?? "ТС"} (${recipient}).`
      ));
    }
  }

  // ── Приёмка топлива ────────────────────────────────────────────────────────
  if (action === "receipt") {
    const shift = findOpenShift(driver.id);
    if (!shift) return void (await showMenu(ctx, driver, "⚠️ Сначала откройте смену."));

    if (sub === "begin") {
      session.step = { name: "await_receipt_liters" };
      return void (await ctx.reply(
        `В цистерне ${formatLiters(currentRemaining(shift))} л.\nСколько литров принимаем?`
      ));
    }

    if (sub === "save") {
      if (session.step.name !== "confirm_receipt") {
        return void (await showMenu(ctx, driver, "Нечего записывать — начните заново."));
      }
      const { liters } = session.step;
      const res = receive(shift, liters);
      resetStep(tgId);
      if (!res.ok) return void (await showMenu(ctx, driver, `⚠️ ${res.error}`));
      return void (await showMenu(
        ctx,
        driver,
        `✅ Принято ${formatLiters(liters)} л. В цистерне ${formatLiters(res.value.remaining)} л.`
      ));
    }
  }
}
