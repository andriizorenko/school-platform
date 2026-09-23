import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { RequestId } from "../../common/request-id.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/types";
import { RequirePermissions } from "../iam/require-permissions.decorator";
import { ChangeStaffRoleDto } from "./dto/change-staff-role.dto";
import { CreateStaffDto } from "./dto/create-staff.dto";
import { UpdateStaffDto } from "./dto/update-staff.dto";
import { StaffService } from "./staff.service";

@Controller("staff")
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @RequirePermissions("roles.manage")
  @Post()
  create(@Body() dto: CreateStaffDto, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.staff.create(dto, user, requestId);
  }

  @RequirePermissions("staff.view")
  @Get()
  list(@Query("search") search?: string, @Query("role") role?: string, @Query("status") status?: string) {
    return this.staff.list({ search, role, status });
  }

  @RequirePermissions("staff.view")
  @Get("managers")
  listManagers() {
    return this.staff.listManagers();
  }

  @RequirePermissions("staff.view")
  @Get(":userId")
  getById(@Param("userId", ParseUUIDPipe) userId: string) {
    return this.staff.getById(userId);
  }

  @RequirePermissions("roles.manage")
  @Patch(":userId")
  update(@Param("userId", ParseUUIDPipe) userId: string, @Body() dto: UpdateStaffDto, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.staff.update(userId, dto, user, requestId);
  }

  @RequirePermissions("roles.manage")
  @Patch(":userId/role")
  changeRole(@Param("userId", ParseUUIDPipe) userId: string, @Body() dto: ChangeStaffRoleDto, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.staff.changeRole(userId, dto, user, requestId);
  }

  @RequirePermissions("roles.manage")
  @Post(":userId/archive")
  archive(@Param("userId", ParseUUIDPipe) userId: string, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.staff.archive(userId, user, requestId);
  }

  @RequirePermissions("roles.manage")
  @Post(":userId/reactivate")
  reactivate(@Param("userId", ParseUUIDPipe) userId: string, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.staff.reactivate(userId, user, requestId);
  }
}
