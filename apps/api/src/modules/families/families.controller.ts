import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { RequestId } from "../../common/request-id.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/types";
import { RequirePermissions } from "../iam/require-permissions.decorator";
import { ArchiveFamilyDto } from "./dto/archive-family.dto";
import { CreateFamilyDto } from "./dto/create-family.dto";
import { UpdateParentProfileDto } from "./dto/update-parent-profile.dto";
import { FamiliesService } from "./families.service";

@Controller("families")
export class FamiliesController {
  constructor(private readonly families: FamiliesService) {}

  @RequirePermissions("family.manage")
  @Post()
  create(@Body() dto: CreateFamilyDto, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.families.create(dto, user, requestId);
  }

  @RequirePermissions("family.view")
  @Get(":familyId")
  getById(@Param("familyId", ParseUUIDPipe) familyId: string) {
    return this.families.getById(familyId);
  }

  @RequirePermissions("family.manage")
  @Patch(":familyId/parent")
  updateParent(
    @Param("familyId", ParseUUIDPipe) familyId: string,
    @Body() dto: UpdateParentProfileDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.families.updateParent(familyId, dto, user, requestId);
  }

  @RequirePermissions("family.manage")
  @Post(":familyId/archive")
  archive(
    @Param("familyId", ParseUUIDPipe) familyId: string,
    @Body() dto: ArchiveFamilyDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.families.archive(familyId, dto, user, requestId);
  }

  @RequirePermissions("family.manage")
  @Post(":familyId/reactivate")
  reactivate(
    @Param("familyId", ParseUUIDPipe) familyId: string,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.families.reactivate(familyId, user, requestId);
  }
}
