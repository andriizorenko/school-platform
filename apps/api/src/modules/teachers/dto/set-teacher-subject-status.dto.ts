import { IsBoolean } from "class-validator";

export class SetTeacherSubjectStatusDto {
  @IsBoolean()
  active!: boolean;
}
