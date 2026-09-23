import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthUser } from "../auth/types";
import { UpdateNotificationPreferenceDto } from "./dto/update-notification-preference.dto";
import { NotificationsService } from "./notifications.service";

@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query("limit") limit?: string) {
    const parsed = limit ? Number.parseInt(limit, 10) : undefined;
    return this.notifications.list(user.id, Number.isFinite(parsed) ? parsed : undefined);
  }

  @Post("read-all")
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.id);
  }

  @Patch(":notificationId/read")
  markRead(
    @Param("notificationId", ParseUUIDPipe) notificationId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.notifications.markRead(notificationId, user.id);
  }

  @Get("preferences")
  preferences(@CurrentUser() user: AuthUser) {
    return this.notifications.getPreferences(user.id, user.roles);
  }

  @Patch("preferences")
  updatePreference(@Body() dto: UpdateNotificationPreferenceDto, @CurrentUser() user: AuthUser) {
    return this.notifications.updatePreference(user, dto);
  }

  @Get("telegram")
  telegramStatus(@CurrentUser() user: AuthUser) {
    return this.notifications.telegramStatus(user.id);
  }

  @Post("telegram/link")
  telegramLink(@CurrentUser() user: AuthUser) {
    return this.notifications.createTelegramLink(user.id);
  }

  @Post("telegram/disconnect")
  telegramDisconnect(@CurrentUser() user: AuthUser) {
    return this.notifications.disconnectTelegram(user.id);
  }
}
