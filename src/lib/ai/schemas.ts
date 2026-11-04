import { z } from "zod";
import { ROLES } from "../types";

/** "YYYY-MM-DDTHH:mm" in the business's local time. */
export const wallTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use YYYY-MM-DDTHH:mm local time")
  .describe("Local wall-clock time, format YYYY-MM-DDTHH:mm");

export const timeWindow = z.object({
  start: wallTime,
  end: wallTime.describe("Exclusive end. 'All day Saturday' ends at 00:00 on Sunday."),
  note: z.string().describe("A few words in the worker's terms, e.g. 'sister's wedding'"),
});

export const constraintUpdate = z.object({
  messageId: z.string().describe("The id of the message these constraints come from"),
  summary: z.string().describe("One short line, owner-facing, e.g. 'Off Sat (wedding); wants Tue eve, Wed'"),
  unavailable: z.array(timeWindow).describe("Hard: times the worker cannot work"),
  preferred: z.array(timeWindow).describe("Soft: times the worker offered or asked for"),
  preferredRoles: z.array(z.enum(ROLES)).describe("Roles the worker said they prefer"),
  maxHours: z.number().int().positive().max(80).optional().describe("Weekly hour cap, only if the worker stated one"),
  dropShiftIds: z
    .array(z.string())
    .describe("Ids of shifts ALREADY ASSIGNED to this worker that they can no longer do (sick call, swap away)"),
});

export const recordConstraintsInput = z.object({
  updates: z.array(constraintUpdate),
});
export type RecordConstraintsInput = z.infer<typeof recordConstraintsInput>;
export type ConstraintUpdate = z.infer<typeof constraintUpdate>;

export const assignment = z.object({
  shiftId: z.string(),
  workerId: z.string(),
  reason: z
    .string()
    .describe("One sentence for the owner explaining the pick, citing the worker's message, cost or hours"),
});

export const assignShiftsInput = z.object({
  assignments: z.array(assignment),
  summary: z.string().describe("Two sentences max: what you did and anything the owner should know"),
});
export type AssignShiftsInput = z.infer<typeof assignShiftsInput>;
