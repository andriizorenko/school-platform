import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, Matches, Max, Min, ValidateNested } from "class-validator";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class RegularScheduleSlotDto {
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek!: number;

  @Matches(TIME_PATTERN)
  startTime!: string;

  @IsIn([30, 60])
  durationMinutes!: 30 | 60;
}

export class SetRegularScheduleDto {
  @IsDateString({ strict: true })
  effectiveFrom!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(14)
  @ValidateNested({ each: true })
  @Type(() => RegularScheduleSlotDto)
  slots!: RegularScheduleSlotDto[];
}
