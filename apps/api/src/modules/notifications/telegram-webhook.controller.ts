import { BadRequestException, Body, Controller, ForbiddenException, Headers, Post } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Public } from "../auth/public.decorator";
import { NotificationsService } from "./notifications.service";

type TelegramUpdate = {
  message?: {
    text?: string;
    chat?: { id?: number | string };
    from?: { id?: number | string; username?: string };
  };
};

@Controller("integrations/telegram")
export class TelegramWebhookController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post("webhook")
  async webhook(
    @Body() update: TelegramUpdate,
    @Headers("x-telegram-bot-api-secret-token") secret?: string,
  ) {
    const expected = this.config.get<string>("TELEGRAM_WEBHOOK_SECRET");
    if (expected && secret !== expected) {
      throw new ForbiddenException({ code: "TELEGRAM_WEBHOOK_FORBIDDEN", message: "Invalid Telegram webhook secret" });
    }

    const text = update.message?.text?.trim() ?? "";
    const match = text.match(/^\/start(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]+)$/);
    if (!match) return { ok: true, ignored: true };

    const fromId = update.message?.from?.id;
    const chatId = update.message?.chat?.id;
    if (fromId === undefined || chatId === undefined) {
      throw new BadRequestException({ code: "TELEGRAM_UPDATE_INVALID", message: "Telegram user/chat data is missing" });
    }

    await this.notifications.connectFromTelegramStart({
      token: match[1],
      telegramUserId: BigInt(fromId),
      telegramChatId: BigInt(chatId),
      username: update.message?.from?.username,
    });

    return { ok: true, connected: true };
  }
}
