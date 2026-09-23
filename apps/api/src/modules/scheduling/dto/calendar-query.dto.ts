import { IsDateString, IsIn, IsOptional, IsUUID } from "class-validator";

export class CalendarQueryDto {
  @IsDateString({ strict: true }) from!: string;
  @IsDateString({ strict: true }) to!: string;
  @IsOptional() @IsUUID() teacherId?: string;
  @IsOptional() @IsUUID() studentId?: string;
  @IsOptional() @IsUUID() subjectId?: string;
  @IsOptional() @IsUUID() managerId?: string;
  @IsOptional() @IsIn(["FIRST","REGULAR"]) sessionType?: "FIRST"|"REGULAR";
  @IsOptional() @IsIn(["PAID","BOOKED"]) fundingStatus?: "PAID"|"BOOKED";
}
