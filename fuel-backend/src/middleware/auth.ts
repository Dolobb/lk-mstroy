import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

const unauthorizedResponse = { error: "Unauthorized" };

type DriverJwtPayload = jwt.JwtPayload & {
  sub: string;
};

function readBearerToken(req: Request): string | null {
  const authorization = req.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorization.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

function timingSafeStringEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) {
    crypto.timingSafeEqual(expectedBuffer, expectedBuffer);
    return false;
  }

  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export function requireDriver(req: Request, res: Response, next: NextFunction): void {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  const token = readBearerToken(req);
  if (!token) {
    res.status(401).json(unauthorizedResponse);
    return;
  }

  try {
    const payload = jwt.verify(token, jwtSecret) as DriverJwtPayload;

    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      res.status(401).json(unauthorizedResponse);
      return;
    }

    req.driverId = payload.sub;
    next();
  } catch {
    res.status(401).json(unauthorizedResponse);
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const expectedToken = process.env.ADMIN_BEARER_TOKEN;
  if (!expectedToken) {
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  const token = readBearerToken(req);
  if (!token || !timingSafeStringEqual(token, expectedToken)) {
    res.status(401).json(unauthorizedResponse);
    return;
  }

  next();
}
