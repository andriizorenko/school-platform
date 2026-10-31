import { IsInt, IsString, IsUUID, Max, MaxLength, Min, MinLength } from "class-validator";

export class CreateTeacherReviewDto {
  @IsUUID()
  sessionId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  comment!: string;
}
