import { z } from "zod";

export const createFamilySchema = z.object({
  parent: z.object({
    email: z.string().email(),
    firstName: z.string().trim().min(1),
    lastName: z.string().trim().min(1),
    phone: z.string().trim().min(1),
  }),
});

export type CreateFamilyInput = z.infer<typeof createFamilySchema>;
