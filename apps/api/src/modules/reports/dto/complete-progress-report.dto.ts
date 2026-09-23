import { IsString, MinLength } from "class-validator";

export class CompleteProgressReportDto {
  @IsString()
  @MinLength(2)
  strengths!: string;

  @IsString()
  @MinLength(2)
  gaps!: string;

  @IsString()
  @MinLength(2)
  actionPlan!: string;
}
