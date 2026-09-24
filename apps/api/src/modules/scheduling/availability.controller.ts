import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { RequestId } from "../../common/request-id.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/types";
import { RequirePermissions } from "../iam/require-permissions.decorator";
import { AvailabilityService } from "./availability.service";
import { MatchTeachersDto } from "./dto/match-teachers.dto";
import { SetTeacherAvailabilityDto } from "./dto/set-teacher-availability.dto";
import { SetAvailabilityExceptionDto } from "./dto/set-availability-exception.dto";
import { CreateVacationRequestDto, ReviewVacationDto } from "./dto/vacation.dto";

@Controller("teachers")
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @RequirePermissions("teacher.view")
  @Post("match-schedule")
  matchTeachers(
    @Body() dto: MatchTeachersDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.availability.matchTeachers(dto, user);
  }

  @RequirePermissions("teacher.availability.view")
  @Get(":teacherId/availability")
  get(@Param("teacherId", ParseUUIDPipe) teacherId: string, @CurrentUser() user: AuthUser) {
    return this.availability.getTeacherAvailability(teacherId, user);
  }

  @RequirePermissions("teacher.availability.manage")
  @Put(":teacherId/availability")
  set(
    @Param("teacherId", ParseUUIDPipe) teacherId: string,
    @Body() dto: SetTeacherAvailabilityDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.availability.setTemplate(teacherId, dto, user, requestId);
  }

  @RequirePermissions("teacher.availability.manage")
  @Put(":teacherId/availability/exception")
  exception(
    @Param("teacherId", ParseUUIDPipe) teacherId: string,
    @Body() dto: SetAvailabilityExceptionDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.availability.setException(teacherId, dto, user, requestId);
  }

  @RequirePermissions("teacher.availability.manage")
  @Delete(":teacherId/availability/exceptions/:date")
  deleteException(
    @Param("teacherId", ParseUUIDPipe) teacherId: string,
    @Param("date") date: string,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.availability.deleteException(teacherId, date, user, requestId);
  }

  @RequirePermissions("teacher.availability.manage")
  @Post(":teacherId/vacations")
  vacation(
    @Param("teacherId", ParseUUIDPipe) teacherId: string,
    @Body() dto: CreateVacationRequestDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.availability.createVacationRequest(teacherId, dto, user, requestId);
  }
}


@Controller("teacher-vacations")
export class VacationOperationsController {
  constructor(private readonly availability: AvailabilityService) {}

  @RequirePermissions("teacher.availability.view")
  @Get()
  list(@CurrentUser() user: AuthUser, @Query("status") status?: string) {
    return this.availability.listVacationRequests(user, status ?? "OPEN");
  }

  @RequirePermissions("teacher.availability.view")
  @Get(":vacationId")
  impact(
    @Param("vacationId", ParseUUIDPipe) vacationId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.availability.getVacationImpact(vacationId, user);
  }

  @RequirePermissions("teacher.availability.manage")
  @Patch(":vacationId/review")
  review(
    @Param("vacationId", ParseUUIDPipe) vacationId: string,
    @Body() dto: ReviewVacationDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.availability.reviewVacation(vacationId, dto, user, requestId);
  }
}
