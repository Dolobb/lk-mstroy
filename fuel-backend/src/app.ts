import express, { type ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { bootstrapRouter } from "./routes/bootstrap.js";
import { syncRouter } from "./routes/sync.js";
import { uploadsRouter } from "./routes/uploads.js";

export const app = express();

// За nginx (один hop): иначе req.ip = 127.0.0.1 и rate-limit станет общим на всех клиентов
app.set("trust proxy", 1);

app.use(express.json({ limit: "1mb" }));

app.use("/auth", authRouter);
app.use("/bootstrap", bootstrapRouter);
app.use("/sync", syncRouter);
app.use("/uploads", uploadsRouter);
app.use("/admin", adminRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: "Validation error",
      details: error.issues
    });
    return;
  }

  res.status(500).json({
    error: "Internal server error"
  });
};

app.use(errorHandler);
