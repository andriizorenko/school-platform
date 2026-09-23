import { z } from "zod";

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm");

export const availabilitySeasonSchema = z.enum(["SCHOOL_YEAR", "SUMMER"]);

export const availabilityWindowSchema = z.object({
  dayOfWeek: z.number().int().min(1).max(7),
  startTime: timeSchema,
  endTime: timeSchema,
});

export const setTeacherAvailabilitySchema = z.object({
  season: availabilitySeasonSchema,
  windows: z.array(availabilityWindowSchema).max(30),
});

export const regularScheduleSlotSchema = z.object({
  dayOfWeek: z.number().int().min(1).max(7),
  startTime: timeSchema,
  durationMinutes: z.union([z.literal(30), z.literal(60)]),
});

export const setRegularScheduleSchema = z.object({
  effectiveFrom: z.string().date(),
  slots: z.array(regularScheduleSlotSchema).min(1).max(14),
});

export const calendarQuerySchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  teacherId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
});

export type SetTeacherAvailabilityInput = z.infer<typeof setTeacherAvailabilitySchema>;
export type SetRegularScheduleInput = z.infer<typeof setRegularScheduleSchema>;
export type CalendarQueryInput = z.infer<typeof calendarQuerySchema>;

export const assignSubstituteSchema = z.object({
  teacherId: z.string().uuid(),
});

export const vacationStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]);

export const createVacationRequestSchema = z.object({
  startsOn: z.string().date(),
  endsOn: z.string().date(),
  comment: z.string().max(1000).optional(),
});

export const reviewVacationSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  comment: z.string().max(1000).optional(),
});

export type AssignSubstituteInput = z.infer<typeof assignSubstituteSchema>;
export type CreateVacationRequestInput = z.infer<typeof createVacationRequestSchema>;
export type ReviewVacationInput = z.infer<typeof reviewVacationSchema>;

export const teacherMatchScheduleSchema = z.object({
  subjectId: z.string().uuid(),
  effectiveFrom: z.string().date(),
  slots: z.array(regularScheduleSlotSchema).min(1).max(14),
});

export type TeacherMatchScheduleInput = z.infer<typeof teacherMatchScheduleSchema>;

export type TeacherScheduleMatchResult = {
  teacherId: string;
  firstName: string;
  lastName: string;
  phone: string;
  zoomUrl?: string | null;
  matchType: "FULL" | "PARTIAL" | "NONE";
  selectable: boolean;
  matchedSlots: number;
  requestedSlots: number;
  conflictCount: number;
  slots: Array<{
    dayOfWeek: number;
    startTime: string;
    durationMinutes: 30 | 60;
    templateCovered: boolean;
    conflictCount: number;
    conflicts: Array<{ date: string; type: "VACATION" | "EXCEPTION" | "BUSY" }>;
  }>;
};

export const changePrimaryTeacherSchema = z.object({
  teacherId: z.string().uuid(),
});

export type ChangePrimaryTeacherInput = z.infer<typeof changePrimaryTeacherSchema>;
