import { IsOptional, IsString, MaxLength } from "class-validator";

export class ArchiveStudentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
