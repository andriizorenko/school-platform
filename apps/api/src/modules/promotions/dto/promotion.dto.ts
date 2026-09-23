import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from "class-validator";

export class CreatePromotionDto {
  @IsString()
  @MaxLength(160)
  name!: string;

  @IsIn(["PERCENT", "FIXED_AMOUNT", "SPECIAL_PRICE"])
  discountType!: "PERCENT" | "FIXED_AMOUNT" | "SPECIAL_PRICE";

  /** Percent points for PERCENT, minor currency units for money-based types. */
  @IsInt()
  @Min(0)
  discountValue!: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  code?: string;

  @IsOptional()
  @IsBoolean()
  isAutomatic?: boolean;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;

  @IsIn(["REGULAR_LESSONS", "FIRST_LESSON", "COURSE"])
  productType!: "REGULAR_LESSONS" | "FIRST_LESSON" | "COURSE";

  /** Omit subject/course to target every item of productType. */
  @IsOptional()
  @IsUUID()
  subjectId?: string;

  @IsOptional()
  @IsUUID()
  courseId?: string;
}
