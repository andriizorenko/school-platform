import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { OpsController } from "./ops.controller";
import { OpsService } from "./ops.service";
@Module({imports:[AuditModule],controllers:[OpsController],providers:[OpsService],exports:[OpsService]})
export class OpsModule {}
