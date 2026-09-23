import { IsBoolean, IsOptional, IsUUID } from "class-validator";

export class RequestProgressReportDto {
  @IsUUID()
  subjectId!: string;

  @IsOptional()
  @IsBoolean()
  visibleToStudent?: boolean;
}
