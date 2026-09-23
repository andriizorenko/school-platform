import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class CompleteFirstLessonDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  strengths!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  gaps!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  actionPlan!: string;

  @IsOptional()
  @IsBoolean()
  visibleToStudent?: boolean;
}
