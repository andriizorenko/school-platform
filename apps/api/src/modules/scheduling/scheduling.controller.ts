import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { RequestId } from "../../common/request-id.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/types";
import { PermissionScope } from "../iam/permission-scope.decorator";
import { RequirePermissions } from "../iam/require-permissions.decorator";
import { CreateFirstLessonDto } from "./dto/create-first-lesson.dto";
import { RescheduleSessionDto } from "./dto/reschedule-session.dto";
import { FreeSlotsQueryDto } from "./dto/free-slots-query.dto";
import { ScheduleExtraLessonDto } from "./dto/schedule-extra-lesson.dto";
import { SetRegularScheduleDto } from "./dto/set-regular-schedule.dto";
import { AssignSubstituteDto } from "./dto/assign-substitute.dto";
import { ChangePrimaryTeacherDto } from "./dto/change-primary-teacher.dto";
import { StudentPauseDto } from "./dto/student-pause.dto";
import { SchedulingService } from "./scheduling.service";

@Controller()
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  @RequirePermissions("lesson.first.manage")
  @Post("first-lessons")
  createFirstLesson(
    @Body() dto: CreateFirstLessonDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.scheduling.createFirstLesson(dto, user, requestId);
  }

  @RequirePermissions("teacher.assignment.manage")
  @Post("enrollments/:enrollmentId/change-primary-teacher")
  changePrimaryTeacher(
    @Param("enrollmentId", ParseUUIDPipe) enrollmentId: string,
    @Body() dto: ChangePrimaryTeacherDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.scheduling.changePrimaryTeacher(enrollmentId, dto, user, requestId);
  }

  @RequirePermissions("student.schedule.manage")
  @PermissionScope("ENROLLMENT", "enrollmentId")
  @Put("enrollments/:enrollmentId/schedule")
  setRegularSchedule(
    @Param("enrollmentId", ParseUUIDPipe) enrollmentId: string,
    @Body() dto: SetRegularScheduleDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.scheduling.setRegularSchedule(enrollmentId, dto, user, requestId);
  }

  @RequirePermissions("lesson.view")
  @Get("enrollments/:enrollmentId/schedule")
  getRegularSchedule(
    @Param("enrollmentId", ParseUUIDPipe) enrollmentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.scheduling.getRegularSchedule(enrollmentId, user);
  }

  @RequirePermissions("lesson.view")
  @Get("sessions/:sessionId")
  getSessionDetail(
    @Param("sessionId", ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.scheduling.getSessionDetail(sessionId, user);
  }

  @RequirePermissions("lesson.reschedule")
  @Get("sessions/:sessionId/free-slots")
  freeSlots(
    @Param("sessionId", ParseUUIDPipe) sessionId: string,
    @Query() query: FreeSlotsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.scheduling.listFreeSlots(sessionId, query, user);
  }

  @RequirePermissions("lesson.reschedule")
  @Post("sessions/:sessionId/reschedule")
  reschedule(
    @Param("sessionId", ParseUUIDPipe) sessionId: string,
    @Body() dto: RescheduleSessionDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.scheduling.rescheduleSession(sessionId, dto, user, requestId);
  }
  @RequirePermissions("lesson.reschedule")
  @Get("sessions/:sessionId/extra-lesson/options")
  extraLessonOptions(
    @Param("sessionId", ParseUUIDPipe) sessionId: string,
    @Query() query: FreeSlotsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.scheduling.extraLessonOptions(sessionId, query, user);
  }

  @RequirePermissions("lesson.reschedule")
  @Post("sessions/:sessionId/extra-lesson")
  scheduleExtraLesson(
    @Param("sessionId", ParseUUIDPipe) sessionId: string,
    @Body() dto: ScheduleExtraLessonDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.scheduling.scheduleExtraLesson(sessionId, dto, user, requestId);
  }

  @RequirePermissions("lesson.reschedule")
  @Get("sessions/:sessionId/substitute-candidates")
  substituteCandidates(
    @Param("sessionId", ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.scheduling.listSubstituteCandidates(sessionId, user);
  }

  @RequirePermissions("lesson.reschedule")
  @Post("sessions/:sessionId/substitute")
  assignSubstitute(@Param("sessionId",ParseUUIDPipe) sessionId:string,@Body() dto:AssignSubstituteDto,@CurrentUser() user:AuthUser,@RequestId() requestId?:string){return this.scheduling.assignSubstitute(sessionId,dto,user,requestId);}

  @RequirePermissions("enrollment.manage")
  @Post("enrollments/:enrollmentId/pause")
  pauseEnrollment(@Param("enrollmentId",ParseUUIDPipe) enrollmentId:string,@Body() dto:StudentPauseDto,@CurrentUser() user:AuthUser,@RequestId() requestId?:string){return this.scheduling.pauseEnrollment(enrollmentId,dto,user,requestId);}

}
