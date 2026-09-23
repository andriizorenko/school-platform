import { IsOptional, IsString, MaxLength } from "class-validator";

export class ReportLessonIncidentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
