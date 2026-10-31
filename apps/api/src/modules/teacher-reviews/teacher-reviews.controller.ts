import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/types";
import { CreateTeacherReviewDto } from "./dto/create-teacher-review.dto";
import { ModerateTeacherReviewDto } from "./dto/moderate-teacher-review.dto";
import { TeacherReviewsService } from "./teacher-reviews.service";

@Controller("teacher-reviews")
export class TeacherReviewsController {
  constructor(private readonly reviews: TeacherReviewsService) {}

  @Get("parent/opportunities")
  parentOpportunities(@CurrentUser() user: AuthUser) {
    return this.reviews.parentOpportunities(user);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTeacherReviewDto) {
    return this.reviews.create(user, dto);
  }

  @Get("me")
  mine(@CurrentUser() user: AuthUser) {
    return this.reviews.mine(user);
  }

  @Get("admin/pending")
  pending(@CurrentUser() user: AuthUser) {
    return this.reviews.pending(user);
  }

  @Patch("admin/:id")
  moderate(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ModerateTeacherReviewDto) {
    return this.reviews.moderate(user, id, dto.status);
  }
}
