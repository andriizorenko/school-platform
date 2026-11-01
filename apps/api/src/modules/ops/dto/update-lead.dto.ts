import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class UpdateLeadDto {
  @IsIn(["NEW", "CONTACTED", "FIRST_LESSON", "CONVERTED", "LOST"]) @IsOptional()
  status?: "NEW" | "CONTACTED" | "FIRST_LESSON" | "CONVERTED" | "LOST";
  @IsUUID() @IsOptional() primaryManagerId?: string;
  @IsUUID() @IsOptional() convertedFamilyId?: string;
  @IsUUID() @IsOptional() convertedStudentId?: string;
  @IsUUID() @IsOptional() firstLessonSessionId?: string;
  @IsUUID() @IsOptional() convertedEnrollmentId?: string;
  @IsString() @MaxLength(1000) @IsOptional() refusalReason?: string;
}
