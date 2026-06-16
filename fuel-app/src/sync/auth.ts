import bcrypt from "bcryptjs";

/**
 * Офлайн-проверка PIN против закэшированного bcrypt-хэша (`pinHash` из ответа `/auth/login`,
 * сохранённого в secure-store после первого онлайн-входа). `compareSync` для 4-значного PIN —
 * десятки мс, приемлемо для экрана входа; bcryptjs совместим с `$2b$`-хэшами бэкенда.
 */
export function verifyPinOffline(pin: string, pinHash: string): boolean {
  if (!pinHash) return false;
  return bcrypt.compareSync(pin, pinHash);
}
