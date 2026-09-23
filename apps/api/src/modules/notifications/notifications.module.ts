import { Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { TelegramWebhookController } from "./telegram-webhook.controller";

@Module({
  controllers: [NotificationsController, TelegramWebhookController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
