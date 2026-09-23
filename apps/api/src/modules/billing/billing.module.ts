import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { SchedulingModule } from "../scheduling/scheduling.module";
import { PromotionsModule } from "../promotions/promotions.module";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { LiqPayService } from "./providers/liqpay.service";
import { MonoService } from "./providers/mono.service";
import { PaymentProvidersService } from "./providers/payment-providers.service";

@Module({
  imports: [AuditModule, SchedulingModule, PromotionsModule],
  controllers: [BillingController],
  providers: [BillingService, LiqPayService, MonoService, PaymentProvidersService],
  exports: [BillingService],
})
export class BillingModule {}
