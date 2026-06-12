import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { z } from "zod";

import { db } from "../db/client.js";
import { fuelReceiptEvents, shifts } from "../db/schema.js";
import { requireDriver } from "../middleware/auth.js";

const maxUploadSizeBytes = 2 * 1024 * 1024;

const uploadBodySchema = z.object({
  receiptId: z.string().uuid()
});

type SupportedImage = {
  ext: "jpg" | "png" | "webp";
  mime: "image/jpeg" | "image/png" | "image/webp";
};

function getUploadsDir(): string {
  return path.resolve(process.env.UPLOADS_DIR ?? "./uploads");
}

function ensureUploadsDir(): string {
  const uploadsDir = getUploadsDir();
  fsSync.mkdirSync(uploadsDir, { recursive: true });
  return uploadsDir;
}

ensureUploadsDir();

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, ensureUploadsDir());
  },
  filename: (_req, _file, callback) => {
    callback(null, `upload-${crypto.randomUUID()}.tmp`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: maxUploadSizeBytes
  }
});

const uploadsRateLimitMax = Number(process.env.UPLOADS_RATE_LIMIT_MAX ?? 60);

const uploadsRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number.isFinite(uploadsRateLimitMax) && uploadsRateLimitMax > 0 ? uploadsRateLimitMax : 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many requests" });
  }
});

export const uploadsRouter = Router();

uploadsRouter.post("/ttn", requireDriver, uploadsRateLimit, (req, res, next) => {
  upload.single("photo")(req, res, async (error: unknown) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      await removeUploadedFile(req);
      res.status(413).json({ error: "File too large" });
      return;
    }

    if (error) {
      next(error);
      return;
    }

    try {
      const file = req.file;
      const input = uploadBodySchema.parse(req.body);

      if (!file) {
        res.status(400).json({ error: "Photo file is required" });
        return;
      }

      const imageType = await detectImageType(file.path, file.mimetype);
      if (!imageType) {
        await removeFile(file.path);
        res.status(415).json({ error: "Unsupported media type" });
        return;
      }

      const [receipt] = await db
        .select({
          id: fuelReceiptEvents.id,
          driverId: shifts.driverId
        })
        .from(fuelReceiptEvents)
        .innerJoin(shifts, eq(fuelReceiptEvents.shiftId, shifts.id))
        .where(eq(fuelReceiptEvents.id, input.receiptId))
        .limit(1);

      if (!receipt) {
        await removeFile(file.path);
        res.status(404).json({ error: "Receipt event not found" });
        return;
      }

      if (receipt.driverId !== req.driverId) {
        await removeFile(file.path);
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      // Замена файла строго ПОСЛЕ авторизации: иначе чужой receiptId позволял бы
      // перезаписать/удалить уже загруженное фото другого водителя
      const targetPath = path.join(getUploadsDir(), `${input.receiptId}.${imageType.ext}`);
      await replaceFile(file.path, targetPath);

      const relativePath = path.relative(process.cwd(), targetPath);

      await db
        .update(fuelReceiptEvents)
        .set({
          ttnPhotoPath: relativePath,
          ttnPhotoStatus: "uploaded"
        })
        .where(eq(fuelReceiptEvents.id, input.receiptId));

      res.json({ ok: true, receiptId: input.receiptId });
    } catch (routeError) {
      await removeUploadedFile(req);
      next(routeError);
    }
  });
});

async function detectImageType(filePath: string, mimetype: string): Promise<SupportedImage | null> {
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(12);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);

    if (
      mimetype === "image/jpeg" &&
      bytesRead >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    ) {
      return { ext: "jpg", mime: "image/jpeg" };
    }

    if (
      mimetype === "image/png" &&
      bytesRead >= 4 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      return { ext: "png", mime: "image/png" };
    }

    if (
      mimetype === "image/webp" &&
      bytesRead >= 12 &&
      buffer.subarray(0, 4).equals(Buffer.from("RIFF")) &&
      buffer.subarray(8, 12).equals(Buffer.from("WEBP"))
    ) {
      return { ext: "webp", mime: "image/webp" };
    }

    return null;
  } finally {
    await handle.close();
  }
}

async function replaceFile(sourcePath: string, targetPath: string): Promise<void> {
  await removeFile(targetPath);
  await fs.rename(sourcePath, targetPath);
}

async function removeUploadedFile(req: Request): Promise<void> {
  if (req.file?.path) {
    await removeFile(req.file.path);
  }
}

async function removeFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
