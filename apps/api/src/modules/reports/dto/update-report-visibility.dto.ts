import { IsBoolean } from "class-validator";

export class UpdateReportVisibilityDto {
  @IsBoolean()
  visibleToStudent!: boolean;
}
