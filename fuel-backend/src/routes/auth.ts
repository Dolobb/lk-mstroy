import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { db } from "../db/client.js";
import { drivers } from "../db/schema.js";

const invalidCredentialsResponse = { error: "Неверный логин или PIN" };
const disabledAccountResponse = { error: "Учётная запись отключена" };
const fakePinHash = "$2b$10$5guk3hUNV2es.G1Cvqjrk.rs0OrrlfQmFEqvHi5zsjC5dvKwAptSm";

const loginSchema = z.object({
  login: z.string().trim().min(1),
  pin: z.string().regex(/^\d{4}$/)
});

export const authRouter = Router();

const authRateLimitMax = Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10);

authRouter.post(
  "/login",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number.isFinite(authRateLimitMax) && authRateLimitMax > 0 ? authRateLimitMax : 10,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: "Too many requests" });
    }
  }),
  async (req, res) => {
    const input = loginSchema.parse(req.body);

    const [driver] = await db
      .select({
        id: drivers.id,
        login: drivers.login,
        fullName: drivers.fullName,
        pinHash: drivers.pinHash,
        isActive: drivers.isActive
      })
      .from(drivers)
      .where(eq(drivers.login, input.login))
      .limit(1);

    const pinMatches = await bcrypt.compare(input.pin, driver?.pinHash ?? fakePinHash);

    if (!driver || !pinMatches) {
      res.status(401).json(invalidCredentialsResponse);
      return;
    }

    if (driver.isActive === false) {
      res.status(403).json(disabledAccountResponse);
      return;
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      res.status(500).json({ error: "Internal server error" });
      return;
    }

    const token = jwt.sign({ sub: driver.id }, jwtSecret, { expiresIn: "7d" });

    res.json({
      token,
      driver: {
        id: driver.id,
        login: driver.login,
        fullName: driver.fullName,
        pinHash: driver.pinHash
      }
    });
  }
);
