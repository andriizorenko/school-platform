import { IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from "class-validator";

export class RefundPaymentDto {
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0.5)
  lessonUnits!: number;

  @IsOptional()
  @IsUUID()
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
