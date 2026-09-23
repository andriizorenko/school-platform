import { IsBoolean, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from "class-validator";

export class TransferLessonBalanceDto {
  @IsUUID()
  toEnrollmentId!: string;

  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0.5)
  lessonUnits!: number;

  @IsOptional()
  @IsBoolean()
  requestedByParent?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
