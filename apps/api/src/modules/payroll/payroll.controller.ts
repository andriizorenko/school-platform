import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { RequestId } from "../../common/request-id.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/types";
import { RequirePermissions } from "../iam/require-permissions.decorator";
import { BulkConfirmPayoutsDto } from "./dto/bulk-confirm-payouts.dto";
import { PayoutDetailsDto } from "./dto/payout-details.dto";
import { PayrollService } from "./payroll.service";

@Controller("payroll")
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @RequirePermissions("payroll.operations.view")
  @Get("periods")
  periods() {
    return this.payroll.ensurePeriods();
  }

  @RequirePermissions("payroll.confirm")
  @Post("periods/:id/calculate")
  calculate(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.payroll.calculate(id, user, requestId);
  }

  @RequirePermissions("payroll.operations.view")
  @Get("periods/:id/payouts")
  payouts(
    @Param("id", ParseUUIDPipe) id: string,
    @Query("status") status?: string,
    @Query("q") query?: string,
  ) {
    return this.payroll.periodDetail(id, status || undefined, query || undefined);
  }

  @RequirePermissions("payroll.view")
  @Get("payouts/:id")
  payout(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.payroll.payoutDetail(id, user);
  }

  @RequirePermissions("payroll.confirm")
  @Post("payouts/:id/confirm")
  confirm(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.payroll.confirm(id, user, requestId);
  }

  @RequirePermissions("payroll.confirm")
  @Post("payouts/bulk-confirm")
  bulkConfirm(
    @Body() dto: BulkConfirmPayoutsDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.payroll.bulkConfirm(dto, user, requestId);
  }

  @RequirePermissions("payroll.view")
  @Get("teachers/:teacherId/statement")
  statement(
    @Param("teacherId", ParseUUIDPipe) teacherId: string,
    @CurrentUser() user: AuthUser,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.payroll.statement(user, teacherId, from, to);
  }

  @RequirePermissions("payroll.view")
  @Get("teachers/:teacherId/payouts")
  teacherPayoutHistory(@Param("teacherId", ParseUUIDPipe) teacherId: string, @CurrentUser() user: AuthUser) {
    return this.payroll.payoutsForTeacher(teacherId, user);
  }

  @RequirePermissions("payroll.operations.view")
  @Get("teachers")
  financierTeachers(@Query("q") query?: string) {
    return this.payroll.financierTeachers(query || undefined);
  }

  @RequirePermissions("payroll.view")
  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return this.payroll.teacherPayouts(user);
  }

  @RequirePermissions("payroll.view")
  @Get("me/statement")
  myStatement(@CurrentUser() user: AuthUser, @Query("from") from?: string, @Query("to") to?: string) {
    return this.payroll.statement(user, undefined, from, to);
  }

  @RequirePermissions("payroll.details.manage")
  @Get("teachers/:teacherId/details")
  payoutDetails(@Param("teacherId", ParseUUIDPipe) teacherId: string, @CurrentUser() user: AuthUser) {
    return this.payroll.getDetails(teacherId, user);
  }

  @RequirePermissions("payroll.details.manage")
  @Put("teachers/:teacherId/details")
  details(
    @Param("teacherId", ParseUUIDPipe) teacherId: string,
    @Body() dto: PayoutDetailsDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.payroll.setDetails(teacherId, dto, user, requestId);
  }
}
