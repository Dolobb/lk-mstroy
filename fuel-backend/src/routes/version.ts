import { Router } from "express";

// Значения обновляются вручную при выкладке нового APK на VPS.
const versionInfo = {
  version: process.env.APP_VERSION ?? "1.0.0",
  buildNumber: Number(process.env.APP_BUILD_NUMBER ?? "1"),
  apkUrl: process.env.APP_APK_URL ?? "https://atz.pisarenkovmax.ru/downloads/fuel-app-latest.apk",
};

export const versionRouter = Router();

// Публичный — без requireDriver/requireAdmin: приложение может быть ещё не залогинено.
versionRouter.get("/", (_req, res) => {
  res.json(versionInfo);
});
