import { z } from "zod";

export const requestProgressReportSchema = z.object({
  subjectId: z.string().uuid(),
  visibleToStudent: z.boolean().optional(),
});

export const completeProgressReportSchema = z.object({
  strengths: z.string().trim().min(2),
  gaps: z.string().trim().min(2),
  actionPlan: z.string().trim().min(2),
});

export const updateReportVisibilitySchema = z.object({
  visibleToStudent: z.boolean(),
});

export const reportRequestEligibilityStatusSchema = z.enum(["AVAILABLE", "PENDING", "TOO_EARLY", "INACTIVE", "NO_TEACHER"]);

export const reportRequestEligibilitySchema = z.object({
  enrollmentId: z.string().uuid(),
  subjectId: z.string().uuid(),
  subjectName: z.string(),
  enrollmentStatus: z.string(),
  status: reportRequestEligibilityStatusSchema,
  completedLessonsSincePreviousReport: z.number().int().nonnegative(),
  requiredLessons: z.number().int().positive(),
  remainingLessons: z.number().int().nonnegative(),
  nextRegularLessonAt: z.coerce.date().nullable().optional(),
  pendingRequest: z.object({
    id: z.string().uuid(),
    targetSessionId: z.string().uuid().nullable().optional(),
    targetStartsAt: z.coerce.date().nullable().optional(),
    visibleToStudent: z.boolean(),
    createdAt: z.coerce.date(),
  }).nullable(),
});

export type RequestProgressReportInput = z.infer<typeof requestProgressReportSchema>;
export type CompleteProgressReportInput = z.infer<typeof completeProgressReportSchema>;
export type UpdateReportVisibilityInput = z.infer<typeof updateReportVisibilitySchema>;
export type ReportRequestEligibility = z.infer<typeof reportRequestEligibilitySchema>;
