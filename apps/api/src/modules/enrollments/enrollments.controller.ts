import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { RequestId } from "../../common/request-id.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/types";
import { RequirePermissions } from "../iam/require-permissions.decorator";
import { AssignTeacherDto } from "./dto/assign-teacher.dto";
import { CreateEnrollmentDto } from "./dto/create-enrollment.dto";
import { EnrollmentsService } from "./enrollments.service";

@Controller()
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @RequirePermissions("enrollment.manage")
  @Post("students/:studentId/enrollments")
  create(
    @Param("studentId", ParseUUIDPipe) studentId: string,
    @Body() dto: CreateEnrollmentDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.enrollments.create(studentId, dto, user, requestId);
  }

  @RequirePermissions("student.view")
  @Get("students/:studentId/enrollments")
  listForStudent(
    @Param("studentId", ParseUUIDPipe) studentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.enrollments.listForStudent(studentId, user);
  }

  @RequirePermissions("student.view")
  @Get("enrollments/:enrollmentId")
  getById(
    @Param("enrollmentId", ParseUUIDPipe) enrollmentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.enrollments.getById(enrollmentId, user);
  }

  @RequirePermissions("teacher.assignment.manage")
  @Post("enrollments/:enrollmentId/assign-teacher")
  assignTeacher(
    @Param("enrollmentId", ParseUUIDPipe) enrollmentId: string,
    @Body() dto: AssignTeacherDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.enrollments.assignTeacher(enrollmentId, dto, user, requestId);
  }
}
