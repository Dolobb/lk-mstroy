import { z } from "zod";

const uuidSchema = z.uuid();
const isoDateTimeSchema = z.string().datetime({ offset: true });
const optionalNullableTrimmedString = (maxLength: number) =>
  z.string().trim().max(maxLength).nullable().optional();

const litersSchema = z
  .number()
  .positive()
  .max(99999.99)
  .refine((value) => Math.abs(Math.round(value * 100) - value * 100) < Number.EPSILON, {
    message: "Number must have at most 2 decimal places"
  });

export const orgAddEventSchema = z
  .object({
    type: z.literal("org_add"),
    id: uuidSchema,
    name: z.string().trim().min(1).max(200)
  })
  .strict();

export const vehicleAddEventSchema = z
  .object({
    type: z.literal("vehicle_add"),
    id: uuidSchema,
    gosNumber: z.string().trim().min(1).max(20),
    mark: optionalNullableTrimmedString(200),
    vehicleType: optionalNullableTrimmedString(100),
    organizationId: uuidSchema
  })
  .strict();

export const shiftOpenEventSchema = z
  .object({
    type: z.literal("shift_open"),
    id: uuidSchema,
    atzId: uuidSchema,
    startedAtClient: isoDateTimeSchema,
    openingRemainingLiters: z.number().nullable().optional()
  })
  .strict();

export const shiftCloseEventSchema = z
  .object({
    type: z.literal("shift_close"),
    id: uuidSchema,
    endedAtClient: isoDateTimeSchema,
    closingRemainingLiters: z.number().nullable().optional()
  })
  .strict();

export const dispenseUpsertEventSchema = z
  .object({
    type: z.literal("dispense_upsert"),
    id: uuidSchema,
    shiftId: uuidSchema,
    vehicleId: uuidSchema,
    liters: litersSchema,
    happenedAtClient: isoDateTimeSchema,
    isDeleted: z.boolean().optional(),
    editedAt: isoDateTimeSchema.nullable().optional()
  })
  .strict();

export const receiptUpsertEventSchema = z
  .object({
    type: z.literal("receipt_upsert"),
    id: uuidSchema,
    shiftId: uuidSchema,
    liters: litersSchema,
    happenedAtClient: isoDateTimeSchema,
    isDeleted: z.boolean().optional(),
    editedAt: isoDateTimeSchema.nullable().optional()
  })
  .strict();

export const syncEventSchema = z.discriminatedUnion("type", [
  orgAddEventSchema,
  vehicleAddEventSchema,
  shiftOpenEventSchema,
  shiftCloseEventSchema,
  dispenseUpsertEventSchema,
  receiptUpsertEventSchema
]);

export const syncRequestSchema = z
  .object({
    deviceId: z.string().min(1).max(100),
    events: z.array(syncEventSchema).min(1).max(500)
  })
  .strict();

export const syncResultSchema = z
  .object({
    id: uuidSchema,
    type: z.string(),
    status: z.enum(["applied", "conflict", "error"]),
    code: z.string().optional(),
    message: z.string().optional()
  })
  .strict();

export const syncResponseSchema = z
  .object({
    serverTime: z.string(),
    results: z.array(syncResultSchema),
    atzBalances: z.array(
      z
        .object({
          atzId: uuidSchema,
          remainingLiters: z.number()
        })
        .strict()
    )
  })
  .strict();

export type SyncRequest = z.infer<typeof syncRequestSchema>;
export type SyncEvent = z.infer<typeof syncEventSchema>;
export type SyncResult = z.infer<typeof syncResultSchema>;
export type SyncResponse = z.infer<typeof syncResponseSchema>;

export interface SyncService {
  process(driverId: string, request: SyncRequest): Promise<SyncResponse>;
}
