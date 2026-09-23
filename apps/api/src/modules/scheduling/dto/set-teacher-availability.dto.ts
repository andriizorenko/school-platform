import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsIn, IsInt, Matches, Max, Min, ValidateNested } from "class-validator";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class AvailabilityWindowDto {
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek!: number;

  @Matches(TIME_PATTERN)
  startTime!: string;

  @Matches(TIME_PATTERN)
  endTime!: string;
}

export class SetTeacherAvailabilityDto {
  @IsIn(["SCHOOL_YEAR", "SUMMER"])
  season!: "SCHOOL_YEAR" | "SUMMER";

  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => AvailabilityWindowDto)
  windows!: AvailabilityWindowDto[];
}
