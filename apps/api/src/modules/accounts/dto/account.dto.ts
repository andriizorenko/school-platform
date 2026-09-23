import { IsEmail, IsString, IsUUID, MinLength } from "class-validator";
export class AcceptInvitationDto { @IsString() token!:string; @IsString() @MinLength(8) password!:string; }
export class ForgotPasswordDto { @IsEmail() email!:string; }
export class ResetPasswordDto { @IsString() token!:string; @IsString() @MinLength(8) password!:string; }
export class SuspendUserDto { @IsString() reason!:string; }
export class CreateStudentAccountDto { @IsEmail() email!:string; }
