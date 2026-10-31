import { IsIn } from "class-validator";

export class ModerateTeacherReviewDto {
  @IsIn(["APPROVED", "REJECTED"])
  status!: "APPROVED" | "REJECTED";
}
