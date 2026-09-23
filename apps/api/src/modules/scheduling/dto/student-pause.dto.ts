import { IsDateString } from "class-validator";
export class StudentPauseDto { @IsDateString() startsOn!:string; @IsDateString() returnsOn!:string; }
