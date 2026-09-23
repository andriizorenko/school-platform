import { IsDateString, IsEmail, IsNotEmpty, IsOptional, IsString, IsUrl } from "class-validator";

export class CreateTeacherDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  zoomUrl?: string;

  @IsOptional()
  @IsDateString()
  startedAt?: string;
}
