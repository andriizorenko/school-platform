import { IsIn, IsOptional, IsString } from "class-validator";
export class ReviewTeacherApplicationDto {
  @IsIn(["APPROVED","REJECTED"])
  status!: "APPROVED"|"REJECTED";
  @IsOptional() @IsString() comment?: string;
}
