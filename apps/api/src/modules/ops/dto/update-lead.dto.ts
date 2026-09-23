import { IsIn, IsOptional, IsUUID } from "class-validator";
export class UpdateLeadDto {
  @IsIn(["NEW", "CONTACTED", "FIRST_LESSON", "CONVERTED", "LOST"]) @IsOptional()
  status?: "NEW" | "CONTACTED" | "FIRST_LESSON" | "CONVERTED" | "LOST";
  @IsUUID() @IsOptional() primaryManagerId?: string;
}
