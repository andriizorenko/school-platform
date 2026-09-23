import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from "class-validator";

export class BulkConfirmPayoutsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID("4", { each: true })
  payoutIds!: string[];
}
