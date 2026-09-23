import { z } from "zod";

export const createEnrollmentSchema = z.object({
  subjectId: z.string().uuid(),
  defaultDurationMinutes: z.union([z.literal(30), z.literal(60)]).default(60),
});

export const assignTeacherSchema = z.object({
  teacherId: z.string().uuid(),
});

export type CreateEnrollmentInput = z.infer<typeof createEnrollmentSchema>;
export type AssignTeacherInput = z.infer<typeof assignTeacherSchema>;
