import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from "class-validator";

export class CreateLeadDto {
  @IsIn(["WEBSITE_SIGNUP", "CALLBACK", "MANUAL", "COURSE", "OTHER"])
  source!: "WEBSITE_SIGNUP" | "CALLBACK" | "MANUAL" | "COURSE" | "OTHER";

  @IsString() @IsOptional() parentFirstName?: string;
  @IsString() @IsOptional() parentLastName?: string;
  @IsString() @IsOptional() studentFirstName?: string;
  @IsString() @IsOptional() studentLastName?: string;
  @IsString() phone!: string;
  @IsEmail() @IsOptional() email?: string;
  @IsString() @IsOptional() telegram?: string;
  @IsUUID() @IsOptional() subjectId?: string;
  @IsInt() @Min(1) @Max(12) @IsOptional() gradeLevel?: number;
  @IsString() @IsOptional() desiredSchedule?: string;
  @IsString() @IsOptional() learningGoal?: string;
  @IsString() @IsOptional() teacherPreference?: string;
  @IsBoolean() @IsOptional() createStudentAccount?: boolean;
  @IsUUID() @IsOptional() primaryManagerId?: string;
}
