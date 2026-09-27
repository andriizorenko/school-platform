import { IsBoolean, IsDateString, ValidateIf } from "class-validator";

export class UpdatePastRescheduleAccessDto {
  @IsBoolean()
  enabled!: boolean;

  @ValidateIf((dto: UpdatePastRescheduleAccessDto) => dto.enabled)
  @IsDateString()
  expiresAt?: string;
}
