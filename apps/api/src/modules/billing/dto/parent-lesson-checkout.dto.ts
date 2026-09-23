import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from "class-validator";

export class ParentLessonCheckoutDto {
  @IsInt()
  @Min(1)
  lessonUnits!: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  promotionCode?: string;

  @IsOptional()
  @IsIn(["LIQPAY", "MONO"])
  paymentProvider?: "LIQPAY" | "MONO";

  @IsOptional()
  @IsUUID()
  idempotencyKey?: string;
}
