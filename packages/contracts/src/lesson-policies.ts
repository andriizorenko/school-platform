import { z } from "zod";

export const lessonIncidentSchema = z.object({
  comment: z.string().max(500).optional(),
});

export const completeFirstLessonSchema = z.object({
  strengths: z.string().trim().min(1).max(4000),
  gaps: z.string().trim().min(1).max(4000),
  actionPlan: z.string().trim().min(1).max(4000),
  visibleToStudent: z.boolean().optional(),
});

export const transferLessonBalanceSchema = z.object({
  toEnrollmentId: z.string().uuid(),
  lessonUnits: z.number().min(0.5).refine((value) => Number.isInteger(value * 2), "Lesson units must be in 0.5 increments"),
  requestedByParent: z.boolean().optional(),
  reason: z.string().max(500).optional(),
});

export const createFirstLessonSchema = z.object({
  studentId: z.string().uuid(),
  subjectId: z.string().uuid(),
  teacherId: z.string().uuid(),
  startsAt: z.string().datetime(),
});

export type LessonIncidentInput = z.infer<typeof lessonIncidentSchema>;
export type CompleteFirstLessonInput = z.infer<typeof completeFirstLessonSchema>;
export type TransferLessonBalanceInput = z.infer<typeof transferLessonBalanceSchema>;
export type CreateFirstLessonInput = z.infer<typeof createFirstLessonSchema>;
