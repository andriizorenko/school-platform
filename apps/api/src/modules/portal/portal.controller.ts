import { Controller, Get, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/types";
import { RequirePermissions } from "../iam/require-permissions.decorator";
import { PortalService } from "./portal.service";

@Controller()
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @RequirePermissions("student.view")
  @Get("parent/dashboard")
  parentDashboard(@CurrentUser() user: AuthUser) {
    return this.portal.parentDashboard(user);
  }

  @RequirePermissions("student.view")
  @Get("parent/reschedules")
  parentReschedules(
    @CurrentUser() user: AuthUser,
    @Query("before") before?: string,
    @Query("limit") limit?: string,
  ) {
    return this.portal.parentReschedules(user, before, limit);
  }

  @RequirePermissions("lesson.balance.view")
  @Get("parent/payments")
  parentPayments(@CurrentUser() user: AuthUser) {
    return this.portal.parentPayments(user);
  }

  @RequirePermissions("student.view")
  @Get("student/dashboard")
  studentDashboard(@CurrentUser() user: AuthUser) {
    return this.portal.studentDashboard(user);
  }
}
