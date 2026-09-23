import { z } from "zod";

export const createTeacherSchema = z.object({
  email: z.string().email(),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  phone: z.string().trim().min(1),
  zoomUrl: z.string().url().optional(),
  startedAt: z.string().date().optional(),
});

export const addTeacherSubjectSchema = z.object({
  subjectId: z.string().uuid(),
});

export const createTeacherRateSchema = z.object({
  rate60Minor: z.number().int().min(0),
  currency: z.string().length(3).default("UAH"),
  effectiveFrom: z.string().date(),
  effectiveUntil: z.string().date().optional(),
});

export type CreateTeacherInput = z.infer<typeof createTeacherSchema>;
export type AddTeacherSubjectInput = z.infer<typeof addTeacherSubjectSchema>;
export type CreateTeacherRateInput = z.infer<typeof createTeacherRateSchema>;

export const updateTeacherSchema = z.object({
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  phone: z.string().trim().min(4).optional(),
  zoomUrl: z.string().url().optional(),
  startedAt: z.string().date().optional(),
});

export const updateMyTeacherProfileSchema = updateTeacherSchema.omit({ startedAt: true });

export const setTeacherSubjectStatusSchema = z.object({ active: z.boolean() });

export type UpdateTeacherInput = z.infer<typeof updateTeacherSchema>;
export type UpdateMyTeacherProfileInput = z.infer<typeof updateMyTeacherProfileSchema>;
export type SetTeacherSubjectStatusInput = z.infer<typeof setTeacherSubjectStatusSchema>;
