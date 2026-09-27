import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { IamModule } from "../iam/iam.module";
import { AvailabilityController } from "./availability.controller";
import { VacationOperationsController } from "./vacation-operations.controller";
import { AvailabilityService } from "./availability.service";
import { CalendarController } from "./calendar.controller";
import { CalendarService } from "./calendar.service";
import { SchedulingController } from "./scheduling.controller";
import { SchedulingService } from "./scheduling.service";
import { FundingMaterializerService } from "./funding-materializer.service";

@Module({
  imports: [AuditModule, IamModule],
  controllers: [AvailabilityController, VacationOperationsController, SchedulingController, CalendarController],
  providers: [AvailabilityService, FundingMaterializerService, SchedulingService, CalendarService],
  exports: [AvailabilityService, FundingMaterializerService, SchedulingService, CalendarService],
})
export class SchedulingModule {}
