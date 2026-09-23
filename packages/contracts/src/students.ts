import { z } from "zod";

export const createStudentSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  birthDate: z.string().date().optional(),
  gradeLevel: z.number().int().min(1).max(12).optional(),
  studentAccountEmail: z.string().email().optional(),
});

export const assignPrimaryManagerSchema = z.object({
  managerUserId: z.string().uuid(),
});

export type CreateStudentInput = z.infer<typeof createStudentSchema>;
export type AssignPrimaryManagerInput = z.infer<typeof assignPrimaryManagerSchema>;
