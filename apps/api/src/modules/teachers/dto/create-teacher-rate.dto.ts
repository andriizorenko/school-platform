import { IsDateString, IsInt, IsOptional, MaxLength, Min } from "class-validator";

export class CreateTeacherRateDto {
  @IsInt()
  @Min(0)
  rate60Minor!: number;

  @IsOptional()
  @MaxLength(3)
  currency?: string;

  @IsDateString()
  effectiveFrom!: string;

  @IsOptional()
  @IsDateString()
  effectiveUntil?: string;
}
