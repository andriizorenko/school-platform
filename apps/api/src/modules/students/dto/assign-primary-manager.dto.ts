import { IsUUID } from "class-validator";

export class AssignPrimaryManagerDto {
  @IsUUID()
  managerUserId!: string;
}
