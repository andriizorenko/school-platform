# LiqPay online payments and refunds (v28)

## Scope

v28 connects the parent lesson checkout to a real payment-provider contract while preserving the existing separation between customer money, lesson entitlement, and teacher payroll.

The provider implementation is isolated in `apps/api/src/modules/billing/providers/liqpay.service.ts`. The current adapter is LiqPay API v7; `PAYMENT_PROVIDER=NONE` keeps online charging disabled without changing manual manager payments.

## Checkout flow

1. Parent requests a quote for an active student/subject enrollment.
2. API creates an immutable `orders` + `lesson_checkout_intents` snapshot.
3. API creates one pending `payments` row for provider `LIQPAY` and returns the signed checkout form (`data`, `signature`).
4. Browser POSTs that form directly to LiqPay checkout.
5. No lesson credit is granted from the browser redirect/result page.
6. LiqPay posts a server-to-server callback to `LIQPAY_CALLBACK_URL`.
7. API verifies the callback signature and merchant public key, records a deduplicated `payment_provider_events` row, locks the order, validates amount/currency, and only then marks payment/order successful.
8. The same transaction materializes the lesson top-up and purchase credit grant and refreshes future session funding.

A repeated callback is safe: `(provider,event_hash)` is unique, and the top-up / purchase grant also have uniqueness guards.

Zero-price promotional checkouts never leave the application: they are finalized internally with provider `PROMOTION` and still produce the same order/top-up/credit ledger shape.

## Callback authenticity

The implementation follows the current LiqPay callback contract:

- callback body is `application/x-www-form-urlencoded` with `data` and `signature`;
- signature is Base64(SHA3-256(private_key + data + private_key));
- callback `public_key` must equal the configured merchant key;
- lesson entitlement is granted only after a valid `success` callback whose amount and currency match the stored order snapshot.

Official references (checked for v28):

- https://www.liqpay.ua/doc/api/internet_acquiring
- https://www.liqpay.ua/doc/api/internet_acquiring/checkout
- https://www.liqpay.ua/doc/api/callback
- https://www.liqpay.ua/doc/api/internet_acquiring/refund

## Refund flow

Refunds are explicit billing operations protected by `billing.refund`.

1. Staff selects an online LiqPay order and an amount expressed in lesson units (0.5 increments).
2. API locks the order/payment and the purchase grant and refuses to refund credits already consumed or transferred.
3. Money is calculated proportionally from cumulative refunded credits, which avoids rounding drift across multiple partial refunds.
4. A `payment_refunds` row is created in `PENDING` state before the provider call.
5. API calls LiqPay's server-to-server refund endpoint with a signed v7 payload.
6. Once the refund is confirmed (`reversed`), one `PURCHASE_REFUND` lesson-credit debit is allocated specifically to the original purchase grant.
7. `payments.refunded_minor`, payment status, and order status become `PARTIALLY_REFUNDED` or `REFUNDED`.
8. Future funding is rematerialized from the reduced balance.

A transport/provider failure updates only a still-`PENDING` refund. This prevents a race where an asynchronous callback confirms the refund while the synchronous HTTP request reports an error.

Late/repeated payment `success` callbacks cannot move a partially or fully refunded order back to `PAID`; only provider metadata is refreshed.

## Accounting / analytics

Revenue views use net collected amount:

`order.total_minor - SUM(payments.refunded_minor)`

Orders in `PAID`, `PARTIALLY_REFUNDED`, and `REFUNDED` remain part of the settled-order history. Teacher payroll remains independent: refunding customer money does not rewrite already-created teacher accruals.

## E2E gate

CI runs a local HTTP LiqPay mock for refund API calls. The API E2E scenario performs:

`Parent checkout -> signed success callback -> duplicate callback -> exact credit grant -> Parent refund denied -> Manager partial refund -> exact credit revocation`

The mock verifies the same v7 SHA3-256 signature before returning a confirmed `reversed` refund response.
