import { z } from "zod";

export const markRegularLessonSchema = z.object({
  topicTitle: z.string().trim().min(1).max(300),
  homeworkAssigned: z.boolean(),
});

export type MarkRegularLessonInput = z.infer<typeof markRegularLessonSchema>;
