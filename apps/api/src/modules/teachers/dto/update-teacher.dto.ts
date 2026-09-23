import { IsDateString, IsOptional, IsString, IsUrl, MaxLength, MinLength } from "class-validator";

export class UpdateTeacherDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  zoomUrl?: string;

  @IsOptional()
  @IsDateString()
  startedAt?: string;
}
