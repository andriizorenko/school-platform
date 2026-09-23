import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/types";
import { RequirePermissions } from "../iam/require-permissions.decorator";
import { HistoryService } from "./history.service";

@Controller()
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @RequirePermissions("student.view")
  @Get("students/:studentId/operations-history")
  studentHistory(
    @Param("studentId", ParseUUIDPipe) studentId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.history.studentHistory(studentId, actor);
  }

  @RequirePermissions("family.view")
  @Get("families/:familyId/operations-overview")
  familyOverview(
    @Param("familyId", ParseUUIDPipe) familyId: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.history.familyOverview(familyId, actor);
  }
}
