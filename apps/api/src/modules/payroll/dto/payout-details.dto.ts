import { IsString, MinLength } from "class-validator";
export class PayoutDetailsDto {
  @IsString() destinationType!: string;
  @IsString() @MinLength(4) details!: string;
  @IsString() @MinLength(4) maskedDisplay!: string;
}
