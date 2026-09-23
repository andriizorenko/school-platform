import { IsDateString, IsInt, IsOptional, IsString, Length, Min } from "class-validator";

export class CreateSubjectPriceDto {
  @IsInt()
  @Min(0)
  regular60PriceMinor!: number;

  @IsInt()
  @Min(0)
  firstLessonPriceMinor!: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsDateString({ strict: true })
  effectiveFrom!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  effectiveUntil?: string;
}
