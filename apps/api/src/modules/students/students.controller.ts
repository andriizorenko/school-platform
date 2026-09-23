import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { RequestId } from "../../common/request-id.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/types";
import { RequirePermissions } from "../iam/require-permissions.decorator";
import { ArchiveStudentDto } from "./dto/archive-student.dto";
import { AssignPrimaryManagerDto } from "./dto/assign-primary-manager.dto";
import { CreateStudentDto } from "./dto/create-student.dto";
import { UpdateStudentDto } from "./dto/update-student.dto";
import { StudentsService } from "./students.service";

@Controller()
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @RequirePermissions("student.manage")
  @Post("families/:familyId/students")
  create(
    @Param("familyId", ParseUUIDPipe) familyId: string,
    @Body() dto: CreateStudentDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.students.create(familyId, dto, user, requestId);
  }

  @RequirePermissions("student.view")
  @Get("students/:studentId")
  getById(@Param("studentId", ParseUUIDPipe) studentId: string, @CurrentUser() user: AuthUser) {
    return this.students.getById(studentId, user);
  }

  @RequirePermissions("student.manage")
  @Patch("students/:studentId")
  update(
    @Param("studentId", ParseUUIDPipe) studentId: string,
    @Body() dto: UpdateStudentDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.students.update(studentId, dto, user, requestId);
  }

  @RequirePermissions("student.manage")
  @Post("students/:studentId/archive")
  archive(
    @Param("studentId", ParseUUIDPipe) studentId: string,
    @Body() dto: ArchiveStudentDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.students.archive(studentId, dto, user, requestId);
  }

  @RequirePermissions("student.manage")
  @Post("students/:studentId/reactivate")
  reactivate(
    @Param("studentId", ParseUUIDPipe) studentId: string,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.students.reactivate(studentId, user, requestId);
  }

  @RequirePermissions("student.manager.assign")
  @Post("students/:studentId/primary-manager")
  assignPrimaryManager(
    @Param("studentId", ParseUUIDPipe) studentId: string,
    @Body() dto: AssignPrimaryManagerDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.students.assignPrimaryManager(studentId, dto, user, requestId);
  }
}
