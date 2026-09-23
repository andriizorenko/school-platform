import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { RequestId } from "../../common/request-id.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/types";
import { RequirePermissions } from "../iam/require-permissions.decorator";
import { CreatePromotionDto } from "./dto/promotion.dto";
import { PromotionsService } from "./promotions.service";

@Controller()
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @RequirePermissions("subject.price.view")
  @Get("promotions")
  list(@Query("all") all?: string) { return this.promotions.list(all === "1"); }

  @RequirePermissions("subject.price.manage")
  @Post("promotions")
  create(@Body() dto: CreatePromotionDto, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.promotions.create(dto, user, requestId);
  }

  @RequirePermissions("subject.price.manage")
  @Delete("promotions/:id")
  disable(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @RequestId() requestId?: string) {
    return this.promotions.disable(id, user, requestId);
  }

  @RequirePermissions("subject.price.view")
  @Get("pricing/quote")
  quote(
    @Query("productType") productType: "REGULAR_LESSONS" | "FIRST_LESSON" | "COURSE",
    @Query("subjectId") subjectId?: string,
    @Query("courseId") courseId?: string,
    @Query("planId") planId?: string,
    @Query("quantity") quantity?: string,
    @Query("code") code?: string,
  ) {
    return this.promotions.quote({ productType, subjectId, courseId, planId, quantity: quantity ? Number(quantity) : undefined, code });
  }
}
