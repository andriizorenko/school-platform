import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { RequestId } from "../../common/request-id.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { Public } from "../auth/public.decorator";
import type { AuthUser } from "../auth/types";
import { RequirePermissions } from "../iam/require-permissions.decorator";
import { AddTeacherSubjectDto } from "./dto/add-teacher-subject.dto";
import { CreateTeacherDto } from "./dto/create-teacher.dto";
import { CreateTeacherRateDto } from "./dto/create-teacher-rate.dto";
import { SetTeacherSubjectStatusDto } from "./dto/set-teacher-subject-status.dto";
import { UpdateMyTeacherProfileDto } from "./dto/update-my-teacher-profile.dto";
import { UpdateTeacherDto } from "./dto/update-teacher.dto";
import { TeachersService } from "./teachers.service";

@Controller("teachers")
export class TeachersController {
  constructor(private readonly teachers: TeachersService) {}

  @Public()
  @Get("public/list")
  publicList() {
    return this.teachers.publicList();
  }

  @RequirePermissions("teacher.manage")
  @Post()
  create(
    @Body() dto: CreateTeacherDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.teachers.create(dto, user, requestId);
  }

  @RequirePermissions("teacher.view")
  @Get()
  list() {
    return this.teachers.list();
  }

  @Get("me/profile")
  myProfile(@CurrentUser() user: AuthUser) {
    return this.teachers.getById(user.id);
  }

  @Patch("me/profile")
  updateMyProfile(
    @Body() dto: UpdateMyTeacherProfileDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.teachers.updateMyProfile(dto, user, requestId);
  }

  @RequirePermissions("student.view")
  @Get("me/students")
  myStudents(
    @CurrentUser() user: AuthUser,
    @Query("search") search?: string,
    @Query("status") status?: "ACTIVE" | "ARCHIVED" | "ALL",
  ) {
    return this.teachers.listMyStudents(user, { search, status });
  }

  @RequirePermissions("student.view")
  @Get("me/students/:studentId")
  myStudent(
    @Param("studentId", ParseUUIDPipe) studentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.teachers.getMyStudent(studentId, user);
  }

  @RequirePermissions("teacher.view")
  @Get(":teacherId")
  getById(@Param("teacherId", ParseUUIDPipe) teacherId: string) {
    return this.teachers.getById(teacherId);
  }

  @RequirePermissions("teacher.manage")
  @Patch(":teacherId")
  update(
    @Param("teacherId", ParseUUIDPipe) teacherId: string,
    @Body() dto: UpdateTeacherDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.teachers.updateProfile(teacherId, dto, user, requestId);
  }

  @RequirePermissions("teacher.manage")
  @Post(":teacherId/archive")
  archive(
    @Param("teacherId", ParseUUIDPipe) teacherId: string,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.teachers.archive(teacherId, user, requestId);
  }

  @RequirePermissions("teacher.manage")
  @Post(":teacherId/reactivate")
  reactivate(
    @Param("teacherId", ParseUUIDPipe) teacherId: string,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.teachers.reactivate(teacherId, user, requestId);
  }

  @RequirePermissions("teacher.manage")
  @Post(":teacherId/subjects")
  addSubject(
    @Param("teacherId", ParseUUIDPipe) teacherId: string,
    @Body() dto: AddTeacherSubjectDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.teachers.addSubject(teacherId, dto, user, requestId);
  }

  @RequirePermissions("teacher.manage")
  @Patch(":teacherId/subjects/:subjectId")
  setSubjectStatus(
    @Param("teacherId", ParseUUIDPipe) teacherId: string,
    @Param("subjectId", ParseUUIDPipe) subjectId: string,
    @Body() dto: SetTeacherSubjectStatusDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.teachers.setSubjectStatus(teacherId, subjectId, dto.active, user, requestId);
  }

  @RequirePermissions("audit.view")
  @Get(":teacherId/history")
  history(@Param("teacherId", ParseUUIDPipe) teacherId: string, @Query("limit") limit?: string) {
    return this.teachers.history(teacherId, Number(limit ?? 80));
  }

  @RequirePermissions("teacher.rate.manage")
  @Post(":teacherId/subjects/:subjectId/rates")
  createRate(
    @Param("teacherId", ParseUUIDPipe) teacherId: string,
    @Param("subjectId", ParseUUIDPipe) subjectId: string,
    @Body() dto: CreateTeacherRateDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.teachers.createRate(teacherId, subjectId, dto, user, requestId);
  }

  @RequirePermissions("teacher.rate.view")
  @Get(":teacherId/rates")
  listRates(@Param("teacherId", ParseUUIDPipe) teacherId: string) {
    return this.teachers.listRates(teacherId);
  }
}
