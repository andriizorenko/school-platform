# 0025 — Subject pricing, promotions and parent lesson checkout

## Scope

This slice closes the provider-agnostic commercial contract for tutoring purchases without coupling the domain to a payment gateway.

### Subject tariffs

- Subject prices are versioned by effective date.
- A new tariff automatically closes the previous open tariff on the day before the new tariff starts.
- Past/current versions are immutable through the API; only a future scheduled version may be cancelled.
- 30-minute pricing remains derived as exactly 50% of the current 60-minute subject price.
- Existing lesson credits are never repriced when a new tariff becomes effective.

### Promotions

Promotions are independent from base tariffs and may target:

- regular lessons;
- first lessons;
- courses.

A target can be one subject/course or every product of that type. Supported discount semantics are:

- `PERCENT` — percentage points;
- `FIXED_AMOUNT` — discount in currency minor units;
- `SPECIAL_PRICE` — final promotional price in currency minor units.

A promotion may be automatic or code-based. Promo codes are unique case-insensitively. Pricing chooses the active promotion with the greatest discount among eligible automatic promotions and the explicitly supplied valid code.

Applied promotions are snapshotted into `order_promotions`; later promotion edits/deactivation cannot rewrite financial history.

### Parent regular-lesson checkout

Parent online purchases enforce the `online_min_lesson_units` school setting. The parent can choose any integer lesson quantity at or above that minimum and optionally enter a promo code.

A quote returns the exact current tariff version, unit price, base amount, discount and total. Creating checkout writes:

```text
Order(PENDING_PAYMENT)
  -> LessonCheckoutIntent
  -> optional OrderPromotion snapshot
```

No lesson credits are granted at this point. The future payment provider will confirm the order idempotently and only then create the normal lesson top-up / credit grant / funding refresh. This keeps the current manual-manager payment flow fully functional while avoiding a fake online-payment implementation.

Pending parent checkout orders are visible in family payment history and can be cancelled before payment.

### First lesson promotions

Manual first-lesson payment continues to support operational overrides. When the recorded amount exactly matches the current automatic promotion quote (including a 0 UAH first-lesson campaign), the applied promotion is snapshotted on the order. Teacher payroll remains independent from customer discounts.

## UI

Admin receives `Предмети й тарифи` with:

- subject lifecycle;
- current/next tariff;
- full price history;
- future tariff scheduling/cancellation;
- promotion creation/deactivation.

Parent `Оплати` now includes a regular-lesson purchase calculator and provider-ready checkout creation. Until a real payment gateway is configured, the UI explicitly states that the generated order is pending and does not alter lesson balance.
