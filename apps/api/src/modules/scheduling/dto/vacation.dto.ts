import { IsDateString, IsIn, IsOptional, IsString, MaxLength } from "class-validator";
export class CreateVacationRequestDto { @IsDateString() startsOn!:string; @IsDateString() endsOn!:string; @IsString() @IsOptional() @MaxLength(1000) comment?:string; }
export class ReviewVacationDto { @IsIn(["APPROVED","REJECTED"]) status!:"APPROVED"|"REJECTED"; @IsString() @IsOptional() @MaxLength(1000) comment?:string; }
