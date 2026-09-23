# 0029 — Multi-provider payments: Monobank + LiqPay

## Status

Implemented in v29.

## Goal

Keep the v28 LiqPay payment/refund ledger intact while adding Monobank acquiring as a second real provider. The school domain must not depend on a gateway-specific checkout or refund shape: orders, payments, lesson grants, refunds and analytics remain provider-neutral.

## Provider contract

`PaymentProviderAdapter` exposes the small surface the billing domain needs:

- provider identity;
- readiness/configuration check;
- checkout creation;
- refund request.

`PaymentProvidersService` resolves enabled adapters, exposes the parent-visible provider list and selects `PAYMENT_DEFAULT_PROVIDER`. A `lesson_checkout_intents.payment_provider` snapshot binds each checkout order to one provider. Reusing a checkout idempotency key with another provider is rejected.

## Monobank checkout

The adapter calls `POST /api/merchant/invoice/create` with the amount in minor units, UAH currency code `980`, `merchantPaymInfo.reference=orderId`, a human-readable destination, `redirectUrl`, `webHookUrl`, and `paymentType=debit`. The returned `invoiceId` and `pageUrl` are stored on the payment. A resumed checkout reuses them instead of creating another invoice.

Official source:
https://monobank.ua/api-docs/acquiring/methods/ia/post--api--merchant--invoice--create

## Webhook authenticity and ordering

The public callback endpoint preserves Nest's raw request body (`rawBody: true`). The `x-sign` header is verified with ECDSA/SHA-256 over that exact raw body using the merchant public key. The key can be configured or fetched from `GET /api/merchant/pubkey`; a fetched key is cached and refreshed only after verification fails.

Each verified event is also protected by the existing `(provider,event_hash)` uniqueness constraint. For Monobank, `event_hash` is derived from the exact raw body only, so an ECDSA retry remains idempotent even if the provider generates a different valid signature for the same payload. The Monobank `modifiedDate` is stored as `provider_updated_at`; an event older than the last processed provider timestamp is recorded but ignored as `STALE_PROVIDER_EVENT`. This is required because provider callbacks are not guaranteed to arrive in chronological order.

Official sources:
https://monobank.ua/api-docs/acquiring/instrumenty-rozrobnyka/webhooks
https://monobank.ua/api-docs/acquiring/methods/ia/get--api--merchant--pubkey

## Payment finalization

Neither provider's browser redirect grants lessons. Credits are materialized only after a valid server callback whose stored order, amount and currency match.

When a parent cancels an unpaid Monobank checkout, the platform also calls `POST /api/merchant/invoice/remove` to invalidate the provider invoice. A successful callback received after an order was explicitly cancelled still does not grant credits; it is marked `PAYMENT_FOR_CANCELLED_ORDER_REQUIRES_RECONCILIATION` so captured money can be reconciled/refunded without silently resurrecting a cancelled order.

Official source for invoice invalidation:
https://monobank.ua/api-docs/acquiring/methods/ia/post--api--merchant--invoice--remove

Repeated callbacks cannot duplicate `lesson_topups` or `lesson_credit_grants`. A late success event also cannot regress `PARTIALLY_REFUNDED` or `REFUNDED` state.

## Refunds

`billing.refund` works through the provider that captured the payment. Monobank uses `POST /api/merchant/invoice/cancel` with `invoiceId`, a partial `amount` when applicable and the internal idempotency key as `extRef`.

A provider HTTP response of `success` may finalize immediately. A `processing` result remains pending until a signed webhook confirms the cancellation. `cancelList.extRef` is matched to the refund idempotency key where present. Confirmed refunds create `PURCHASE_REFUND` credit debits and update payment/order state to `PARTIALLY_REFUNDED` or `REFUNDED`.

If the outbound refund request has a transport error or timeout, its status remains `PENDING` with `providerStatus=transport_unknown`. This intentionally treats the provider outcome as unknown rather than failed, preventing a second refund request from being sent while the first may already have been accepted.

Official source:
https://monobank.ua/api-docs/acquiring/methods/ia/post--api--merchant--invoice--cancel

## Security properties

- raw-body signature verification happens before domain processing;
- invalid or missing signatures fail closed;
- amount/currency mismatch never grants lessons;
- unknown invoice callbacks are recorded but cannot create payments/credits;
- stale Monobank callbacks cannot overwrite newer state;
- duplicate callbacks are idempotent;
- cancelled orders are never resurrected by a provider callback;
- refunds can revoke only unused purchased credits;
- uncertain transport outcomes are reconciled instead of blindly retried.

## E2E coverage

CI starts disposable LiqPay and Monobank HTTP mocks. The Monobank mock generates an ECDSA P-256 keypair, exposes `/api/merchant/pubkey`, signs exact webhook bodies through the test-only `/test/sign` endpoint, returns deterministic checkout invoices and simulates asynchronous refunds.

The API acceptance flow verifies:

1. both providers are advertised with Monobank as the configured default;
2. explicit LiqPay checkout/payment/refund still works;
3. one checkout idempotency key cannot switch providers;
4. Monobank invoice creation and resume reuse the same invoice;
5. invalid `x-sign` is rejected;
6. a valid signed `success` grants credits once;
7. a duplicated webhook is ignored idempotently;
8. an older `processing` webhook is ignored after success;
9. a partial Monobank refund remains pending on provider `processing`;
10. a later signed refund webhook revokes the exact refunded lesson units;
11. cancelling a pending Monobank checkout invalidates the provider invoice, and a synthetic late success callback still cannot grant credits.
