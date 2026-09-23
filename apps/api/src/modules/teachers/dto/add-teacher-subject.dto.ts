import { IsUUID } from "class-validator";

export class AddTeacherSubjectDto {
  @IsUUID()
  subjectId!: string;
}
