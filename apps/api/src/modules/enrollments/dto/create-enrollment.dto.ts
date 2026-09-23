import { IsIn, IsOptional, IsUUID } from "class-validator";

export class CreateEnrollmentDto {
  @IsUUID()
  subjectId!: string;

  @IsOptional()
  @IsIn([30, 60])
  defaultDurationMinutes?: 30 | 60;
}
