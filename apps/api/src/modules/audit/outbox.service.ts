import { Inject, Injectable } from "@nestjs/common";
import { outboxEvents } from "@school/db";
import type { Database } from "@school/db";
import { DATABASE } from "../../common/database/database.constants";

type OutboxExecutor = Pick<Database, "insert">;

export type NotificationOutboxPayload = {
  recipientUserIds: string[];
  notification: {
    eventType: string;
    title: string;
    body: string;
    actionPath?: string;
    entityType?: string;
    entityId?: string;
    data?: Record<string, unknown>;
  };
};

@Injectable()
export class OutboxService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async publish(
    input: {
      eventType: string;
      aggregateType: string;
      aggregateId?: string;
      payload: unknown;
      availableAt?: Date;
    },
    executor: OutboxExecutor = this.db,
  ) {
    const [event] = await executor
      .insert(outboxEvents)
      .values({
        eventType: input.eventType,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        payload: input.payload,
        availableAt: input.availableAt,
      })
      .returning({ id: outboxEvents.id });
    return event;
  }

  async publishNotification(
    input: {
      aggregateType: string;
      aggregateId?: string;
      recipientUserIds: string[];
      eventType: string;
      title: string;
      body: string;
      actionPath?: string;
      entityType?: string;
      entityId?: string;
      data?: Record<string, unknown>;
    },
    executor: OutboxExecutor = this.db,
  ) {
    const recipients = [...new Set(input.recipientUserIds.filter(Boolean))];
    if (!recipients.length) return null;

    return this.publish(
      {
        eventType: `NOTIFY_${input.eventType}`,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        payload: {
          recipientUserIds: recipients,
          notification: {
            eventType: input.eventType,
            title: input.title,
            body: input.body,
            actionPath: input.actionPath,
            entityType: input.entityType,
            entityId: input.entityId,
            data: input.data,
          },
        } satisfies NotificationOutboxPayload,
      },
      executor,
    );
  }
}
