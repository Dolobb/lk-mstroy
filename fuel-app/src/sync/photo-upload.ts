import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

/**
 * Сжать фото ТТН перед постановкой в очередь: ресайз до 1280px по ширине (высота авто) +
 * JPEG quality 0.75 → цель ≤500 КБ (бэкенд дополнительно ограничивает 2 МБ). Возвращает локальный URI.
 * SDK 56 — новый context-API expo-image-manipulator (manipulate → renderAsync → saveAsync).
 */
export async function compressTtnPhoto(uri: string): Promise<string> {
  const rendered = await ImageManipulator.manipulate(uri).resize({ width: 1280 }).renderAsync();
  const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.75 });
  return result.uri;
}
