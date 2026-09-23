import { IsDateString, IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from "class-validator";

export class CreateStudentDto {
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  gradeLevel?: number;

  @IsOptional()
  @IsEmail()
  studentAccountEmail?: string;
}
