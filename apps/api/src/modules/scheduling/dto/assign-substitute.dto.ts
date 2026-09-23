import { IsUUID } from "class-validator";
export class AssignSubstituteDto { @IsUUID() teacherId!:string; }
