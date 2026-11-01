import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class UpdateMyProfileDto {
  @IsString() @MinLength(1) @MaxLength(120) firstName!: string;
  @IsString() @MinLength(1) @MaxLength(120) lastName!: string;
  @IsString() @MaxLength(40) phone!: string;
  @IsEmail() email!: string;
  @Matches(/^(?:|@?[A-Za-z0-9_]{5,32})$/) telegramUsername!: string;
  @IsOptional() @IsString() currentPassword?: string;
}
