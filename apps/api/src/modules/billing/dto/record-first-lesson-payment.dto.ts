import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class RecordFirstLessonPaymentDto {
  @IsInt()
  @Min(0)
  amountMinor!: number;

  @IsIn(["CARD", "BANK_TRANSFER", "CASH", "OTHER"])
  paymentMethod!: "CARD" | "BANK_TRANSFER" | "CASH" | "OTHER";

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
