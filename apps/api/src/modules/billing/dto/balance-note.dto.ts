import { IsOptional, IsString, MaxLength } from "class-validator";

export class BalanceNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
