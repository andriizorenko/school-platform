import { IsUUID } from "class-validator";

export class ChangePrimaryTeacherDto {
  @IsUUID()
  teacherId!: string;
}
