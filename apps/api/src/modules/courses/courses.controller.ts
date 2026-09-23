import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { RequestId } from "../../common/request-id.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { Public } from "../auth/public.decorator";
import type { AuthUser } from "../auth/types";
import { RequirePermissions } from "../iam/require-permissions.decorator";
import {
  CreateAccessPlanDto,
  CreateBlockDto,
  CreateCourseDto,
  CreateCourseLessonDto,
  CreateModuleDto,
  CreateQuestionDto,
  CreateSubjectTopicDto,
  CreateTestDto,
  ManualCoursePurchaseDto,
  ReorderDto,
  RequestTutorFromCourseDto,
  StartMistakePracticeDto,
  SubmitAnswerDto,
  UpdateAccessPlanDto,
  UpdateBlockDto,
  UpdateCourseDto,
  UpdateCourseLessonDto,
  UpdateModuleDto,
  UpdateTestDto,
} from "./dto/course.dto";
import { CoursesService } from "./courses.service";

@Controller()
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Public() @Get("public/courses") publicList() { return this.courses.list(); }
  @Public() @Get("public/courses/:id") publicDetail(@Param("id", ParseUUIDPipe) id: string) { return this.courses.detail(id); }

  @RequirePermissions("course.view") @Get("courses")
  list(@CurrentUser() user: AuthUser) { return this.courses.list(user); }

  @RequirePermissions("course.view") @Get("courses/:id")
  detail(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) { return this.courses.detail(id, user); }

  @RequirePermissions("course.manage") @Post("courses")
  create(@Body() dto: CreateCourseDto, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.courses.createCourse(dto, user, requestId);
  }

  @RequirePermissions("course.manage") @Patch("courses/:id")
  updateCourse(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateCourseDto, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.courses.updateCourse(id, dto, user, requestId);
  }

  @RequirePermissions("course.manage") @Get("courses/:id/progress-overview")
  progressOverview(@Param("id", ParseUUIDPipe) id: string) { return this.courses.progressOverview(id); }

  @RequirePermissions("course.manage") @Post("courses/:id/modules")
  module(@Param("id", ParseUUIDPipe) id: string, @Body() dto: CreateModuleDto, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.courses.addModule(id, dto, user, requestId);
  }

  @RequirePermissions("course.manage") @Patch("course-modules/:id")
  updateModule(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateModuleDto, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.courses.updateModule(id, dto, user, requestId);
  }

  @RequirePermissions("course.manage") @Put("courses/:id/modules/order")
  reorderModules(@Param("id", ParseUUIDPipe) id: string, @Body() dto: ReorderDto, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.courses.reorderModules(id, dto.ids, user, requestId);
  }

  @RequirePermissions("course.manage") @Post("course-modules/:id/lessons")
  lesson(@Param("id", ParseUUIDPipe) id: string, @Body() dto: CreateCourseLessonDto, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.courses.addLesson(id, dto, user, requestId);
  }

  @RequirePermissions("course.manage") @Patch("course-lessons/:id")
  updateLesson(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateCourseLessonDto, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.courses.updateLesson(id, dto, user, requestId);
  }

  @RequirePermissions("course.manage") @Get("course-lessons/:id/builder")
  lessonBuilder(@Param("id", ParseUUIDPipe) id: string) { return this.courses.lessonBuilder(id); }

  @RequirePermissions("course.manage") @Put("course-modules/:id/lessons/order")
  reorderLessons(@Param("id", ParseUUIDPipe) id: string, @Body() dto: ReorderDto, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.courses.reorderLessons(id, dto.ids, user, requestId);
  }

  @RequirePermissions("course.manage") @Post("course-lessons/:id/blocks")
  block(@Param("id", ParseUUIDPipe) id: string, @Body() dto: CreateBlockDto, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.courses.addBlock(id, dto, user, requestId);
  }

  @RequirePermissions("course.manage") @Patch("course-blocks/:id")
  updateBlock(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateBlockDto, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.courses.updateBlock(id, dto, user, requestId);
  }

  @RequirePermissions("course.manage") @Delete("course-blocks/:id")
  deleteBlock(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.courses.deleteBlock(id, user, requestId);
  }

  @RequirePermissions("course.manage") @Put("course-lessons/:id/blocks/order")
  reorderBlocks(@Param("id", ParseUUIDPipe) id: string, @Body() dto: ReorderDto, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.courses.reorderBlocks(id, dto.ids, user, requestId);
  }

  @RequirePermissions("course.manage") @Post("courses/:id/access-plans")
  plan(@Param("id", ParseUUIDPipe) id: string, @Body() dto: CreateAccessPlanDto, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.courses.addPlan(id, dto, user, requestId);
  }

  @RequirePermissions("course.manage") @Patch("course-access-plans/:id")
  updatePlan(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateAccessPlanDto, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.courses.updatePlan(id, dto, user, requestId);
  }

  @RequirePermissions("course.manage") @Post("courses/:id/publish")
  publish(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.courses.publish(id, user, requestId);
  }

  @RequirePermissions("course.manage") @Post("courses/:id/archive")
  archive(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.courses.archive(id, user, requestId);
  }

  @RequirePermissions("course.manage") @Post("course-lessons/:id/publish")
  publishLesson(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.courses.publishLesson(id, user, requestId);
  }

  @RequirePermissions("course.manage") @Post("course-lessons/:id/unpublish")
  unpublishLesson(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.courses.unpublishLesson(id, user, requestId);
  }

  @RequirePermissions("course.manage") @Get("subject-topics")
  topics(@Query("subjectId") subjectId?: string) { return this.courses.listTopics(subjectId); }

  @RequirePermissions("course.manage") @Post("subject-topics")
  createTopic(@Body() dto: CreateSubjectTopicDto, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.courses.createTopic(dto, user, requestId);
  }

  @RequirePermissions("course.manage") @Post("tests")
  test(@Body() dto: CreateTestDto, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.courses.createTest(dto, user, requestId);
  }

  @RequirePermissions("course.manage") @Get("tests/:id")
  testDetail(@Param("id", ParseUUIDPipe) id: string) { return this.courses.testDetail(id); }

  @RequirePermissions("course.manage") @Patch("tests/:id")
  updateTest(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateTestDto, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.courses.updateTest(id, dto, user, requestId);
  }

  @RequirePermissions("course.manage") @Post("tests/:id/questions")
  question(@Param("id", ParseUUIDPipe) id: string, @Body() dto: CreateQuestionDto, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.courses.addQuestion(id, dto, user, requestId);
  }

  @RequirePermissions("course.purchase") @Post("course-plans/:id/purchase/manual")
  purchase(@Param("id", ParseUUIDPipe) id: string, @Body() dto: ManualCoursePurchaseDto, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.courses.manualPurchase(id, dto, user, requestId);
  }

  @RequirePermissions("course.purchase") @Post("course-licenses/:licenseId/students/:studentId")
  grant(@Param("licenseId", ParseUUIDPipe) licenseId: string, @Param("studentId", ParseUUIDPipe) studentId: string, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.courses.grantStudent(licenseId, studentId, user, requestId);
  }

  @RequirePermissions("course.purchase") @Get("course-licenses/:id")
  licenseDetail(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) { return this.courses.licenseDetail(id, user); }

  @RequirePermissions("course.progress") @Get("portal/courses")
  my(@CurrentUser() user: AuthUser) { return this.courses.myCourses(user); }

  @RequirePermissions("course.progress") @Get("course-enrollments/:id")
  enrollment(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) { return this.courses.enrollmentContent(id, user); }

  @RequirePermissions("course.progress") @Get("course-enrollments/:id/lessons/:lessonId")
  lessonContent(@Param("id", ParseUUIDPipe) id: string, @Param("lessonId", ParseUUIDPipe) lessonId: string, @CurrentUser() user: AuthUser) {
    return this.courses.lessonContent(id, lessonId, user);
  }

  @RequirePermissions("course.progress") @Post("course-enrollments/:id/lessons/:lessonId/complete")
  completeLesson(@Param("id", ParseUUIDPipe) id: string, @Param("lessonId", ParseUUIDPipe) lessonId: string, @CurrentUser() user: AuthUser) {
    return this.courses.completeLesson(id, lessonId, user);
  }

  @RequirePermissions("course.progress") @Post("course-enrollments/:id/tests/:testId/start")
  start(@Param("id", ParseUUIDPipe) id: string, @Param("testId", ParseUUIDPipe) testId: string, @CurrentUser() user: AuthUser) {
    return this.courses.startTest(id, testId, user);
  }

  @RequirePermissions("course.progress") @Patch("test-attempts/:attemptId/questions/:questionId")
  answer(@Param("attemptId", ParseUUIDPipe) attemptId: string, @Param("questionId", ParseUUIDPipe) questionId: string, @Body() dto: SubmitAnswerDto, @CurrentUser() user: AuthUser) {
    return this.courses.answer(attemptId, questionId, dto, user);
  }

  @RequirePermissions("course.progress") @Post("test-attempts/:attemptId/complete")
  completeAttempt(@Param("attemptId", ParseUUIDPipe) attemptId: string, @CurrentUser() user: AuthUser) {
    return this.courses.completeAttempt(attemptId, user);
  }

  @RequirePermissions("course.progress") @Get("mistakes")
  mistakes(@CurrentUser() user: AuthUser, @Query("studentId") studentId?: string, @Query("courseEnrollmentId") courseEnrollmentId?: string) { return this.courses.mistakes(user, studentId, courseEnrollmentId); }

  @RequirePermissions("course.progress") @Get("course-enrollments/:id/progress-summary")
  progressSummary(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.courses.progressSummary(id, user);
  }

  @RequirePermissions("course.progress") @Get("course-enrollments/:id/test-history")
  testHistory(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.courses.testHistory(id, user);
  }

  @RequirePermissions("course.progress") @Get("test-attempts/:attemptId/result")
  attemptResult(@Param("attemptId", ParseUUIDPipe) attemptId: string, @CurrentUser() user: AuthUser) {
    return this.courses.attemptResult(attemptId, user);
  }

  @RequirePermissions("course.progress") @Post("mistakes/:mistakeId/practice/start")
  startMistakePractice(@Param("mistakeId", ParseUUIDPipe) mistakeId: string, @Body() dto: StartMistakePracticeDto, @CurrentUser() user: AuthUser) {
    return this.courses.startMistakePractice(mistakeId, dto.courseEnrollmentId, user);
  }

  @RequirePermissions("course.progress") @Patch("mistake-practice/:attemptId")
  answerMistakePractice(@Param("attemptId", ParseUUIDPipe) attemptId: string, @Body() dto: SubmitAnswerDto, @CurrentUser() user: AuthUser) {
    return this.courses.answerMistakePractice(attemptId, dto, user);
  }

  @RequirePermissions("course.progress") @Post("course-enrollments/:id/tutor-request")
  tutorRequest(@Param("id", ParseUUIDPipe) id: string, @Body() dto: RequestTutorFromCourseDto, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.courses.requestTutorFromCourse(id, dto, user, requestId);
  }

}
