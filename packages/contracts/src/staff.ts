import { z } from "zod";

export const createStaffSchema = z.object({
  email: z.string().email(),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  phone: z.string().trim().min(1).optional(),
  roleCode: z.enum(["MANAGER", "FINANCIER", "SUPPORT_MANAGER"]),
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const updateStaffSchema = z.object({
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  phone: z.string().trim().max(40).optional(),
  startedAt: z.string().date().optional(),
});

export const changeStaffRoleSchema = z.object({
  roleCode: z.enum(["MANAGER", "FINANCIER", "SUPPORT_MANAGER"]),
});

export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;
export type ChangeStaffRoleInput = z.infer<typeof changeStaffRoleSchema>;
