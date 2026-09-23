import { IsOptional, IsString, MaxLength } from "class-validator";

export class ArchiveFamilyDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
