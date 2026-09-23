import { IsArray, IsEmail, IsOptional, IsString, IsUUID } from "class-validator";
export class CreateTeacherApplicationDto {
  @IsString() firstName!: string;
  @IsString() lastName!: string;
  @IsEmail() email!: string;
  @IsString() phone!: string;
  @IsString() @IsOptional() telegram?: string;
  @IsString() @IsOptional() education?: string;
  @IsString() @IsOptional() experience?: string;
  @IsString() @IsOptional() gradesWorked?: string;
  @IsString() @IsOptional() examExperience?: string;
  @IsString() @IsOptional() approximateHours?: string;
  @IsArray() @IsUUID("4", { each: true }) @IsOptional() subjectIds?: string[];
}
