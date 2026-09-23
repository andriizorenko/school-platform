import { Controller, Get, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/types";
import { RequirePermissions } from "../iam/require-permissions.decorator";
import { CalendarService } from "./calendar.service";
import { CalendarQueryDto } from "./dto/calendar-query.dto";

@Controller("calendar")
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @RequirePermissions("lesson.view")
  @Get("filter-options")
  filterOptions(@CurrentUser() user: AuthUser) {
    return this.calendar.filterOptions(user);
  }

  @RequirePermissions("lesson.view")
  @Get()
  list(@Query() query: CalendarQueryDto, @CurrentUser() user: AuthUser) {
    return this.calendar.list(query, user);
  }
}
