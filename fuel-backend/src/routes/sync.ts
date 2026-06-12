import { Router } from "express";

import { requireDriver } from "../middleware/auth.js";
import { syncService } from "../services/sync.js";
import { syncRequestSchema } from "../services/sync.types.js";

export const syncRouter = Router();

syncRouter.post("/", requireDriver, async (req, res) => {
  const input = syncRequestSchema.parse(req.body);
  const response = await syncService.process(req.driverId!, input);
  res.json(response);
});
