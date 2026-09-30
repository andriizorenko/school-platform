import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class MarkRegularLessonDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  topicTitle!: string;

  @IsBoolean()
  homeworkAssigned!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  homeworkDescription?: string;
}
