import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { RequestId } from "../../common/request-id.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { Public } from "../auth/public.decorator";
import type { AuthUser } from "../auth/types";
import { RequirePermissions } from "../iam/require-permissions.decorator";
import { CreateSubjectDto } from "./dto/create-subject.dto";
import { UpdateSubjectDto } from "./dto/update-subject.dto";
import { SubjectsService } from "./subjects.service";

@Controller("subjects")
export class SubjectsController {
  constructor(private readonly subjects: SubjectsService) {}

  @Public()
  @Get("public/list")
  publicList() { return this.subjects.list(); }

  @RequirePermissions("subject.manage")
  @Post()
  create(@Body() dto: CreateSubjectDto, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.subjects.create(dto, user, requestId);
  }

  @RequirePermissions("subject.view")
  @Get()
  list() { return this.subjects.list(); }

  @RequirePermissions("subject.view")
  @Get(":subjectId")
  getById(@Param("subjectId", ParseUUIDPipe) subjectId: string) { return this.subjects.getById(subjectId); }

  @RequirePermissions("subject.manage")
  @Patch(":subjectId")
  update(
    @Param("subjectId", ParseUUIDPipe) subjectId: string,
    @Body() dto: UpdateSubjectDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) { return this.subjects.update(subjectId, dto, user, requestId); }
}
