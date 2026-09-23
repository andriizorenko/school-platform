import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { RequestId } from "../../common/request-id.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/types";
import { Public } from "../auth/public.decorator";
import { RequirePermissions } from "../iam/require-permissions.decorator";
import { BillingService } from "./billing.service";
import { CreateSubjectPriceDto } from "./dto/create-subject-price.dto";
import { ManualLessonTopupDto } from "./dto/manual-lesson-topup.dto";
import { RecordFirstLessonPaymentDto } from "./dto/record-first-lesson-payment.dto";
import { TransferLessonBalanceDto } from "./dto/transfer-lesson-balance.dto";
import { BalanceNoteDto } from "./dto/balance-note.dto";
import { ParentLessonCheckoutDto } from "./dto/parent-lesson-checkout.dto";
import { RefundPaymentDto } from "./dto/refund-payment.dto";

@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @RequirePermissions("subject.price.view")
  @Get("pricing/subjects")
  listSubjectPricingOverview() {
    return this.billing.listSubjectPricingOverview();
  }

  @RequirePermissions("subject.price.view")
  @Get("subjects/:subjectId/prices")
  getSubjectPriceHistory(@Param("subjectId", ParseUUIDPipe) subjectId: string) {
    return this.billing.getSubjectPriceHistory(subjectId);
  }

  @RequirePermissions("subject.price.manage")
  @Delete("subjects/:subjectId/prices/:priceId")
  cancelFutureSubjectPrice(
    @Param("subjectId", ParseUUIDPipe) subjectId: string,
    @Param("priceId", ParseUUIDPipe) priceId: string,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.billing.cancelFutureSubjectPrice(subjectId, priceId, user, requestId);
  }

  @RequirePermissions("billing.checkout")
  @Get("parent/checkout/config")
  parentCheckoutConfig(@CurrentUser() user: AuthUser) {
    return this.billing.parentCheckoutConfig(user);
  }

  @RequirePermissions("billing.checkout")
  @Get("parent/enrollments/:enrollmentId/checkout/quote")
  parentLessonCheckoutQuote(
    @Param("enrollmentId", ParseUUIDPipe) enrollmentId: string,
    @Query("lessonUnits") lessonUnits: string,
    @Query("promotionCode") promotionCode: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.billing.parentLessonCheckoutQuote(enrollmentId, Number(lessonUnits), promotionCode, user);
  }

  @RequirePermissions("billing.checkout")
  @Post("parent/enrollments/:enrollmentId/checkout")
  createParentLessonCheckout(
    @Param("enrollmentId", ParseUUIDPipe) enrollmentId: string,
    @Body() dto: ParentLessonCheckoutDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.billing.createParentLessonCheckout(enrollmentId, dto, user, requestId);
  }

  @RequirePermissions("billing.checkout")
  @Post("parent/orders/:orderId/payment")
  prepareParentCheckoutPayment(
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.billing.prepareParentCheckoutPayment(orderId, user);
  }

  @RequirePermissions("billing.checkout")
  @Post("parent/orders/:orderId/cancel")
  cancelParentCheckout(
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.billing.cancelParentCheckout(orderId, user, requestId);
  }

  @Public()
  @HttpCode(200)
  @Post("integrations/payments/liqpay/callback")
  liqPayCallback(@Body() body: { data?: string; signature?: string }) {
    return this.billing.handleLiqPayCallback(body.data, body.signature);
  }


  @Public()
  @HttpCode(200)
  @Post("integrations/payments/mono/webhook")
  monoWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers("x-sign") signature: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.billing.handleMonoWebhook(request.rawBody, signature, body);
  }

  @RequirePermissions("billing.refund")
  @Post("billing/orders/:orderId/refunds")
  refundOnlinePayment(
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body() dto: RefundPaymentDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.billing.refundOnlinePayment(orderId, dto, user, requestId);
  }

  @RequirePermissions("subject.price.manage")
  @Post("subjects/:subjectId/prices")
  createSubjectPrice(
    @Param("subjectId", ParseUUIDPipe) subjectId: string,
    @Body() dto: CreateSubjectPriceDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.billing.createSubjectPrice(subjectId, dto, user, requestId);
  }

  @RequirePermissions("subject.price.view")
  @Get("subjects/:subjectId/prices/current")
  getCurrentSubjectPrice(
    @Param("subjectId", ParseUUIDPipe) subjectId: string,
    @Query("date") date?: string,
  ) {
    return this.billing.getCurrentSubjectPrice(subjectId, date);
  }

  @RequirePermissions("billing.record_payment")
  @Post("sessions/:sessionId/first-lesson/payment")
  recordFirstLessonPayment(
    @Param("sessionId", ParseUUIDPipe) sessionId: string,
    @Body() dto: RecordFirstLessonPaymentDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.billing.recordFirstLessonPayment(sessionId, dto, user, requestId);
  }

  @RequirePermissions("lesson.balance.view")
  @Get("enrollments/:enrollmentId/balance")
  getBalance(
    @Param("enrollmentId", ParseUUIDPipe) enrollmentId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.billing.getEnrollmentBalance(enrollmentId, user);
  }

  @RequirePermissions("billing.adjust_balance")
  @Post("enrollments/:enrollmentId/balance/transfer")
  transferBalance(
    @Param("enrollmentId", ParseUUIDPipe) enrollmentId: string,
    @Body() dto: TransferLessonBalanceDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.billing.transferLessonBalance(enrollmentId, dto, user, requestId);
  }

  @RequirePermissions("billing.adjust_balance")
  @Post("enrollments/:enrollmentId/balance/freeze")
  freezeBalance(
    @Param("enrollmentId", ParseUUIDPipe) enrollmentId: string,
    @Body() dto: BalanceNoteDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.billing.freezeLessonBalance(enrollmentId, dto, user, requestId);
  }

  @RequirePermissions("billing.adjust_balance")
  @Post("enrollments/:enrollmentId/balance/write-off")
  writeOffBalance(
    @Param("enrollmentId", ParseUUIDPipe) enrollmentId: string,
    @Body() dto: BalanceNoteDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.billing.writeOffLessonBalance(enrollmentId, dto, user, requestId);
  }

  @RequirePermissions("enrollment.manage")
  @Post("enrollments/:enrollmentId/reactivate")
  reactivateEnrollment(
    @Param("enrollmentId", ParseUUIDPipe) enrollmentId: string,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.billing.reactivateEnrollment(enrollmentId, user, requestId);
  }

  @RequirePermissions("billing.adjust_balance")
  @Post("enrollments/:enrollmentId/topups/manual")
  manualTopup(
    @Param("enrollmentId", ParseUUIDPipe) enrollmentId: string,
    @Body() dto: ManualLessonTopupDto,
    @CurrentUser() user: AuthUser,
    @RequestId() requestId?: string,
  ) {
    return this.billing.manualTopup(enrollmentId, dto, user, requestId);
  }
}
