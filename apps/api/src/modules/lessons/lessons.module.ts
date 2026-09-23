import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { SchedulingModule } from "../scheduling/scheduling.module";
import { LessonPoliciesService } from "./lesson-policies.service";
import { LessonsController } from "./lessons.controller";
import { LessonsService } from "./lessons.service";

@Module({
  imports: [AuditModule, SchedulingModule],
  controllers: [LessonsController],
  providers: [LessonsService, LessonPoliciesService],
  exports: [LessonsService, LessonPoliciesService],
})
export class LessonsModule {}
