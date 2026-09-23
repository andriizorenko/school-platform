import { IsString, MaxLength, MinLength } from "class-validator";

export class ResolvePaymentReconciliationDto {
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  note!: string;
}
