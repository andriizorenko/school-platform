import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsDateString, IsOptional, Matches, ValidateNested } from "class-validator";
const TIME_PATTERN=/^([01]\d|2[0-3]):[0-5]\d$/;
class ExceptionWindowDto { @Matches(TIME_PATTERN) startTime!:string; @Matches(TIME_PATTERN) endTime!:string; }
export class SetAvailabilityExceptionDto {
  @IsDateString() date!:string;
  @IsBoolean() @IsOptional() isUnavailableAllDay?:boolean;
  @IsArray() @ValidateNested({each:true}) @Type(()=>ExceptionWindowDto) @IsOptional() windows?:ExceptionWindowDto[];
}
