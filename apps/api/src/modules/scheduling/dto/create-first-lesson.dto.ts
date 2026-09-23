import { IsDateString, IsUUID } from "class-validator";

export class CreateFirstLessonDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  subjectId!: string;

  @IsUUID()
  teacherId!: string;

  @IsDateString()
  startsAt!: string;
}
