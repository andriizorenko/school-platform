# 0011 — Reminder automation and notification lifecycle

## Goal

Make time-based Telegram notifications reliable without putting scheduling logic inside controllers or domain services.

The worker is responsible for planning and delivering notifications. PostgreSQL remains the source of truth for lessons, balances, preferences and delivery history.

## Timed notifications

The worker plans the following notifications:

- `LESSON_REMINDER` — parent and optional student account, one hour before a scheduled live lesson.
- `UNMARKED_LESSON_REMINDER` — actual teacher on the next local day, while the 48-hour marking window is still open.
- `LOW_BALANCE` — parent once per balance cycle when the remaining balance is positive and reaches or falls below the configured threshold (default: 3 lesson units).
- `ZERO_BALANCE` — parent once per balance cycle when the balance reaches zero.

The financier receives no Telegram notifications.

## Durable planning

Timed notifications are materialized into the `notifications` table ahead of time. This is intentionally different from checking a 10-minute time window and sending immediately.

A planned notification now has:

- `dedup_key` — semantic idempotency key;
- `scheduled_at` — intended delivery time;
- `next_attempt_at` — retry scheduler;
- `last_attempt_at` — interrupted-delivery recovery;
- `expires_at` — point after which the message is no longer useful.

Lesson reminders are planned up to 48 hours ahead by default. If the worker is temporarily unavailable, already planned reminders survive the outage.

## Reschedules

Lesson reminder deduplication includes the concrete session start timestamp:

```text
lesson-reminder:<sessionId>:<startsAt>
```

If the same session is moved, the new start time produces a new reminder key. The worker cancels the old pending reminder after detecting that the stored `startsAt` no longer matches `live_sessions.starts_at`.

This is required because parents are allowed to reschedule the same lesson multiple times.

## Stale notification cancellation

Before delivery the worker cancels notifications that are no longer valid:

- reminder expired because the lesson has already started;
- lesson was cancelled/completed or moved after reminder planning;
- unmarked lesson has since been resolved;
- low-balance warning became stale because the balance increased or reached zero;
- zero-balance warning became stale after replenishment;
- the user disabled that Telegram event type.

Disabled notifications create a `SKIPPED` delivery-history record.

## Retry policy

Telegram delivery uses configurable exponential backoff.

Default policy:

```text
attempt 1 -> retry after 60 s
attempt 2 -> retry after 120 s
attempt 3 -> retry after 240 s
attempt 4 -> retry after 480 s
attempt 5 -> terminal FAILED
```

The delay is capped at one hour. A terminal `FAILED` notification is not selected again because delivery queries require `attempts < notification_retry_max_attempts`.

If a worker process dies after claiming a notification, a `PROCESSING` notification older than ten minutes is recovered to `PENDING` unless it has expired.

Telegram delivery is therefore at-least-once. A process crash after Telegram accepts a message but before PostgreSQL records success can still produce a duplicate on recovery; eliminating that completely is not possible without provider-side idempotency support.

## Settings

The worker reads these values from `school_settings`:

```text
lesson_reminder_minutes              60
notification_planning_horizon_hours  48
unmarked_reminder_local_hour         10
notification_retry_max_attempts       5
notification_retry_base_seconds      60
school_timezone              Europe/Kyiv
teacher_mark_deadline_hours          48
low_balance_lesson_units              3
```

They can later be managed from the Admin settings screen without changing worker code.

## Balance cycles

Low/zero-balance deduplication is tied to the newest credit grant for the enrollment. After a new top-up/transfer/compensation grant, a new balance cycle begins and a future low/zero warning may be sent again.

This implements the product rule that zero-balance messaging is sent once, while still allowing a new warning after the family replenishes and later exhausts the balance again.
