import { IsBoolean } from "class-validator";

export class SetHomeworkCompletionDto {
  @IsBoolean()
  completed!: boolean;
}
