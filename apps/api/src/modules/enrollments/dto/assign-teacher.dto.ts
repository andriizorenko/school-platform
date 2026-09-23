import { IsUUID } from "class-validator";

export class AssignTeacherDto {
  @IsUUID()
  teacherId!: string;
}
