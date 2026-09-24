import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from "@nestjs/common";
import { RequestId } from "../../common/request-id.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/types";
import { RequirePermissions } from "../iam/require-permissions.decorator";
import { AvailabilityService } from "./availability.service";
import { ReviewVacationDto } from "./dto/vacation.dto";

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
