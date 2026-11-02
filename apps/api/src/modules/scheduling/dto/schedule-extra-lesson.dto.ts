import { IsDateString } from "class-validator";

export class ScheduleExtraLessonDto {
  @IsDateString()
  startsAt!: string;
}
