import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { RequestId } from "../../common/request-id.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/types";
import { RequirePermissions } from "../iam/require-permissions.decorator";
import { CompleteFirstLessonDto } from "./dto/complete-first-lesson.dto";
import { MarkRegularLessonDto } from "./dto/mark-regular-lesson.dto";
import { ReportLessonIncidentDto } from "./dto/report-lesson-incident.dto";
import { LessonPoliciesService } from "./lesson-policies.service";
import { LessonsService } from "./lessons.service";

@Controller()
export class LessonsController {
  constructor(
    private readonly lessons: LessonsService,
    private readonly policies: LessonPoliciesService,
  ) {}

  @RequirePermissions("lesson.incident.record")
  @Post("sessions/:sessionId/incidents/student-no-show")
  reportStudentNoShow(
    @Param("sessionId", ParseUUIDPipe) sessionId: string,
    @Body() dto: ReportLessonIncidentDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.policies.reportStudentNoShow(sessionId, dto, user, requestId);
  }

  @RequirePermissions("lesson.incident.record")
  @Post("sessions/:sessionId/incidents/teacher-late-cancellation")
  reportTeacherLateCancellation(
    @Param("sessionId", ParseUUIDPipe) sessionId: string,
    @Body() dto: ReportLessonIncidentDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.policies.reportTeacherLateCancellation(sessionId, dto, user, requestId);
  }

  @RequirePermissions("lesson.mark")
  @Post("sessions/:sessionId/first-lesson/complete")
  completeFirstLesson(
    @Param("sessionId", ParseUUIDPipe) sessionId: string,
    @Body() dto: CompleteFirstLessonDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.policies.completeFirstLesson(sessionId, dto, user, requestId);
  }

  @RequirePermissions("lesson.mark")
  @Post("sessions/:sessionId/mark")
  markRegularLesson(
    @Param("sessionId", ParseUUIDPipe) sessionId: string,
    @Body() dto: MarkRegularLessonDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.lessons.markRegularLesson(sessionId, dto, user, requestId);
  }

  @RequirePermissions("lesson.view")
  @Get("enrollments/:enrollmentId/journal")
  getEnrollmentJournal(
    @Param("enrollmentId", ParseUUIDPipe) enrollmentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.lessons.getEnrollmentJournal(enrollmentId, user);
  }
}
