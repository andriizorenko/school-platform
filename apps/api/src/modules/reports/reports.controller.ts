import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { RequestId } from "../../common/request-id.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/types";
import { RequirePermissions } from "../iam/require-permissions.decorator";
import { CompleteProgressReportDto } from "./dto/complete-progress-report.dto";
import { RequestProgressReportDto } from "./dto/request-progress-report.dto";
import { UpdateReportVisibilityDto } from "./dto/update-report-visibility.dto";
import { ReportsService } from "./reports.service";

@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @RequirePermissions("report.request")
  @Get("students/:studentId/reports/eligibility")
  eligibility(
    @Param("studentId", ParseUUIDPipe) studentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reports.requestEligibility(studentId, user);
  }

  @RequirePermissions("report.request")
  @Post("students/:studentId/reports/request")
  request(
    @Param("studentId", ParseUUIDPipe) studentId: string,
    @Body() dto: RequestProgressReportDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.reports.requestProgressReport(studentId, dto, user, requestId);
  }

  @RequirePermissions("report.view")
  @Get("students/:studentId/reports")
  list(
    @Param("studentId", ParseUUIDPipe) studentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reports.listForStudent(studentId, user);
  }

  @RequirePermissions("report.complete")
  @Get("reports/pending")
  pending(@CurrentUser() user: AuthUser) {
    return this.reports.pendingForTeacher(user);
  }

  @RequirePermissions("report.complete")
  @Post("report-requests/:requestId/complete")
  complete(
    @Param("requestId", ParseUUIDPipe) requestId: string,
    @Body() dto: CompleteProgressReportDto,
    @CurrentUser() user: AuthUser,
    @RequestId() traceId?: string,
  ) {
    return this.reports.completeRequestedReport(requestId, dto, user, traceId);
  }

  @RequirePermissions("report.visibility.manage")
  @Patch("reports/:reportId/visibility")
  visibility(
    @Param("reportId", ParseUUIDPipe) reportId: string,
    @Body() dto: UpdateReportVisibilityDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.reports.updateVisibility(reportId, dto, user, requestId);
  }
}
