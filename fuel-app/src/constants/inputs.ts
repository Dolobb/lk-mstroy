import type { TextStyle } from "react-native";

/**
 * Стиль крупного поля ввода литров. Шрифт `text-display-2xl` = 72px, а контейнер был tap-primary
 * (64px) → контент выше контейнера → внутренняя микропрокрутка/обрезка (баг B3 с планшета).
 * Высота поля поднята выше шрифта, убран лишний вертикальный font-padding (Android),
 * текст по центру. lineHeight НЕ переопределяем — берётся из класса display-2xl.
 */
export const LITERS_INPUT_STYLE: TextStyle = {
  height: 96,
  paddingVertical: 0,
  textAlignVertical: "center",
  includeFontPadding: false,
};
