import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { PayrollController } from "./payroll.controller";
import { PayrollService } from "./payroll.service";
@Module({imports:[AuditModule],controllers:[PayrollController],providers:[PayrollService],exports:[PayrollService]}) export class PayrollModule {}
