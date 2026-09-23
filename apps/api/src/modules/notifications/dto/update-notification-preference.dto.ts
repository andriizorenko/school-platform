import { IsBoolean, IsIn, IsString } from "class-validator";

export class UpdateNotificationPreferenceDto {
  @IsString()
  eventType!: string;

  @IsIn(["TELEGRAM", "EMAIL"])
  channel!: "TELEGRAM" | "EMAIL";

  @IsBoolean()
  enabled!: boolean;
}
