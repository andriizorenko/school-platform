import { IsDateString, IsIn, IsOptional, IsString, MaxLength, ValidateIf } from "class-validator";

const reasons = [
  "PARENT_REQUEST",
  "STUDENT_CANNOT_ATTEND",
  "STUDENT_NO_SHOW",
  "TEACHER_TECHNICAL",
  "TEACHER_PERSONAL",
  "TEACHER_VACATION",
  "STUDENT_PAUSE",
  "SCHOOL_REASON",
  "OTHER",
] as const;

const modes = ["FREE_SLOT", "END_OF_PAID_SEQUENCE", "MANUAL"] as const;

export class RescheduleSessionDto {
  @ValidateIf((dto: RescheduleSessionDto) => dto.mode !== "END_OF_PAID_SEQUENCE")
  @IsDateString()
  startsAt?: string;

  @IsIn(reasons)
  reason!: (typeof reasons)[number];

  @IsIn(modes)
  mode!: (typeof modes)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
