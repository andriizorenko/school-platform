import { IsIn } from "class-validator";

export class ChangeStaffRoleDto {
  @IsIn(["MANAGER", "FINANCIER", "SUPPORT_MANAGER"])
  roleCode!: "MANAGER" | "FINANCIER" | "SUPPORT_MANAGER";
}
