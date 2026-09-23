import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreateStaffDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsIn(["MANAGER", "FINANCIER", "SUPPORT_MANAGER"])
  roleCode!: "MANAGER" | "FINANCIER" | "SUPPORT_MANAGER";
}
