import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";

const API = (process.env.API_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "") + "/api";
const MONO_MOCK = (process.env.MONO_API_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const accounts = {
  admin: { email: required("E2E_ADMIN_EMAIL"), password: required("E2E_ADMIN_PASSWORD"), role: "ADMIN" },
  manager: { email: required("E2E_MANAGER_EMAIL"), password: required("E2E_MANAGER_PASSWORD"), role: "MANAGER" },
  teacher: { email: required("E2E_TEACHER_EMAIL"), password: required("E2E_TEACHER_PASSWORD"), role: "TEACHER" },
  parent: { email: required("E2E_PARENT_EMAIL"), password: required("E2E_PARENT_PASSWORD"), role: "PARENT" },
  student: { email: required("E2E_STUDENT_EMAIL"), password: required("E2E_STUDENT_PASSWORD"), role: "STUDENT" },
};

function cookieFrom(response) {
  const raw = response.headers.get("set-cookie");
  return raw ? raw.split(";", 1)[0] : "";
}

async function request(path, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  return { response, payload, cookie: cookieFrom(response) };
}


async function requestForm(path, fields) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams(fields),
  });
  const payload = await response.json().catch(() => null);
  return { response, payload, cookie: cookieFrom(response) };
}

async function monoSignedWebhook(payload, signatureOverride) {
  const raw = JSON.stringify(payload);
  let signature = signatureOverride;
  if (!signature) {
    const signed = await fetch(`${MONO_MOCK}/test/sign`, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=UTF-8" },
      body: raw,
    });
    assert.equal(signed.status, 200, `mono sign helper failed: ${signed.status}`);
    signature = (await signed.json()).signature;
  }
  const response = await fetch(`${API}/integrations/payments/mono/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sign": signature },
    body: raw,
  });
  const responsePayload = await response.json().catch(() => null);
  return { response, payload: responsePayload };
}

function liqpayCallbackFields(payload) {
  const privateKey = required("LIQPAY_PRIVATE_KEY");
  const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const signature = createHash("sha3-256").update(`${privateKey}${data}${privateKey}`, "utf8").digest("base64");
  return { data, signature };
}

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const output = [];
  for (const character of input.replace(/=+$/, "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function totp(secret, time = Date.now()) {
  const counter = Math.floor(time / 1000 / 30);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

function expectStatus(result, status, label) {
  assert.equal(result.response.status, status, `${label}: expected ${status}, got ${result.response.status}: ${JSON.stringify(result.payload)}`);
}

async function login(account) {
  const result = await request("/auth/login", { method: "POST", body: { email: account.email, password: account.password } });
  expectStatus(result, 201, `${account.role} login`);
  assert.ok(result.cookie, `${account.role} login must set a session cookie`);
  assert.ok(result.payload?.user?.roles?.includes(account.role), `${account.role} login returned wrong roles`);
  return { cookie: result.cookie, login: result.payload };
}

async function run() {
  console.log(`E2E API target: ${API}`);

  const ready = await request("/health/ready");
  expectStatus(ready, 200, "readiness");
  assert.equal(ready.payload?.status, "ready");

  const anonymous = await request("/auth/me");
  expectStatus(anonymous, 401, "anonymous /auth/me");

  const badLogin = await request("/auth/login", { method: "POST", body: { email: accounts.manager.email, password: "definitely-wrong" } });
  expectStatus(badLogin, 401, "wrong password");

  const admin = await login(accounts.admin);
  assert.equal(admin.login.mfaSetupRequired, true, "fresh E2E admin should require MFA setup");
  const adminBeforeMfa = await request("/settings", { cookie: admin.cookie });
  expectStatus(adminBeforeMfa, 403, "admin settings before MFA");
  assert.equal(adminBeforeMfa.payload?.error?.code, "MFA_REQUIRED");
  const setup = await request("/auth/mfa/setup", { method: "POST", cookie: admin.cookie });
  expectStatus(setup, 201, "admin MFA setup");
  assert.ok(setup.payload?.secret, "MFA setup must return a TOTP secret");
  const enable = await request("/auth/mfa/enable", { method: "POST", cookie: admin.cookie, body: { code: totp(setup.payload.secret) } });
  expectStatus(enable, 201, "admin MFA enable");
  assert.equal(enable.payload?.enabled, true);
  assert.equal(enable.payload?.recoveryCodes?.length, 8);
  const adminSettings = await request("/settings", { cookie: admin.cookie });
  expectStatus(adminSettings, 200, "admin settings after MFA");
  const adminDashboard = await request("/ops/dashboard", { cookie: admin.cookie });
  expectStatus(adminDashboard, 200, "admin dashboard");

  const manager = await login(accounts.manager);
  assert.equal(manager.login.mfaRequired, false);
  assert.equal(manager.login.mfaSetupRequired, false);
  expectStatus(await request("/ops/dashboard", { cookie: manager.cookie }), 200, "manager dashboard");
  const managerSettings = await request("/settings", { cookie: manager.cookie });
  expectStatus(managerSettings, 403, "manager settings denied");
  assert.equal(managerSettings.payload?.error?.code, "PERMISSION_DENIED");

  const managerVacations = await request("/teacher-vacations?status=OPEN", { cookie: manager.cookie });
  expectStatus(managerVacations, 200, "manager vacation queue");
  assert.ok(Array.isArray(managerVacations.payload), "manager vacation queue must return an array");

  const [firstLessonStudents, firstLessonSubjects, firstLessonTeachers] = await Promise.all([
    request("/ops/students?lifecycle=ACTIVE", { cookie: manager.cookie }),
    request("/subjects", { cookie: manager.cookie }),
    request("/teachers", { cookie: manager.cookie }),
  ]);
  expectStatus(firstLessonStudents, 200, "first lesson students");
  expectStatus(firstLessonSubjects, 200, "first lesson subjects");
  expectStatus(firstLessonTeachers, 200, "first lesson teachers");
  const firstLessonStudent = firstLessonStudents.payload.find((item) => item.first_name === "E2E" && item.last_name === "Student");
  const firstLessonSubject = firstLessonSubjects.payload.find((item) => item.slug === "e2e-mathematics");
  const firstLessonTeacher = firstLessonTeachers.payload.find((item) => item.firstName === "E2E" && item.lastName === "Teacher");
  assert.ok(firstLessonStudent?.id, "E2E first lesson student fixture missing");
  assert.ok(firstLessonSubject?.id, "E2E first lesson subject fixture missing");
  assert.ok(firstLessonTeacher?.userId, "E2E first lesson teacher fixture missing");

  const firstLessonAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  firstLessonAt.setUTCHours(10, 0, 0, 0);
  const firstLessonBody = {
    studentId: firstLessonStudent.id,
    subjectId: firstLessonSubject.id,
    teacherId: firstLessonTeacher.userId,
    startsAt: firstLessonAt.toISOString(),
  };
  const createdFirstLesson = await request("/first-lessons", {
    method: "POST",
    cookie: manager.cookie,
    body: firstLessonBody,
  });
  expectStatus(createdFirstLesson, 201, "create first lesson");
  assert.equal(createdFirstLesson.payload?.sessionType, "FIRST");
  assert.equal(createdFirstLesson.payload?.fundingStatus, "BOOKED");
  assert.equal(createdFirstLesson.payload?.status, "SCHEDULED");

  const firstLessonConflict = await request("/first-lessons", {
    method: "POST",
    cookie: manager.cookie,
    body: firstLessonBody,
  });
  expectStatus(firstLessonConflict, 409, "first lesson teacher conflict");
  assert.equal(firstLessonConflict.payload?.error?.code, "TEACHER_SESSION_CONFLICT");

  const teacher = await login(accounts.teacher);
  expectStatus(await request("/teachers/me/profile", { cookie: teacher.cookie }), 200, "teacher self profile");
  expectStatus(await request("/teachers/me/students", { cookie: teacher.cookie }), 200, "teacher students");
  expectStatus(await request("/settings", { cookie: teacher.cookie }), 403, "teacher settings denied");

  const parent = await login(accounts.parent);
  const parentDashboard = await request("/parent/dashboard", { cookie: parent.cookie });
  expectStatus(parentDashboard, 200, "parent dashboard");
  assert.ok(parentDashboard.payload?.students?.length >= 1, "parent fixture must expose at least one linked student");

  const parentCourses = await request("/portal/courses", { cookie: parent.cookie });
  expectStatus(parentCourses, 200, "parent course portal");
  assert.ok(Array.isArray(parentCourses.payload), "parent course portal must return an array");
  const parentCourseCatalog = await request("/courses", { cookie: parent.cookie });
  expectStatus(parentCourseCatalog, 200, "parent course catalog");
  assert.ok(Array.isArray(parentCourseCatalog.payload), "parent course catalog must return an array");
  const parentAsStudent = await request("/student/dashboard", { cookie: parent.cookie });
  expectStatus(parentAsStudent, 403, "parent cannot use student dashboard");
  assert.equal(parentAsStudent.payload?.error?.code, "STUDENT_PORTAL_ONLY");
  expectStatus(await request("/ops/families", { cookie: parent.cookie }), 403, "parent operations denied");

  const enrollment = parentDashboard.payload.students.flatMap((entry) => entry.enrollments ?? [])[0];
  assert.ok(enrollment?.id, "parent fixture must expose an enrollment id");
  const initialBalance = Number(enrollment.balanceLessonUnits ?? 0);
  const checkoutConfig = await request("/parent/checkout/config", { cookie: parent.cookie });
  expectStatus(checkoutConfig, 200, "parent checkout config");
  assert.equal(checkoutConfig.payload?.paymentIntegrationReady, true, "CI payment providers must be configured");
  assert.deepEqual(new Set(checkoutConfig.payload?.paymentProviders ?? []), new Set(["LIQPAY", "MONO"]));
  assert.equal(checkoutConfig.payload?.paymentProvider, "MONO", "CI default provider should be mono");
  const purchaseLessons = Number(checkoutConfig.payload.minimumLessonUnits);

  // --- LiqPay purchase + synchronous refund regression ---
  const liqCheckoutKey = randomUUID();
  const checkout = await request(`/parent/enrollments/${enrollment.id}/checkout`, {
    method: "POST",
    cookie: parent.cookie,
    body: { lessonUnits: purchaseLessons, paymentProvider: "LIQPAY", idempotencyKey: liqCheckoutKey },
  });
  expectStatus(checkout, 201, "parent LiqPay checkout");
  assert.equal(checkout.payload?.paymentProvider, "LIQPAY");
  assert.ok(checkout.payload?.providerCheckout?.fields?.signature, "checkout must contain signed LiqPay fields");
  const orderId = checkout.payload?.order?.id;
  assert.ok(orderId, "checkout must return order id");
  const amountMinor = Number(checkout.payload?.order?.totalMinor);
  assert.ok(amountMinor > 0, "checkout amount must be positive");

  const providerConflict = await request(`/parent/enrollments/${enrollment.id}/checkout`, {
    method: "POST",
    cookie: parent.cookie,
    body: { lessonUnits: purchaseLessons, paymentProvider: "MONO", idempotencyKey: liqCheckoutKey },
  });
  expectStatus(providerConflict, 409, "checkout idempotency cannot switch providers");
  assert.equal(providerConflict.payload?.error?.code, "CHECKOUT_IDEMPOTENCY_PROVIDER_CONFLICT");

  const callbackFields = liqpayCallbackFields({
    version: 7,
    public_key: required("LIQPAY_PUBLIC_KEY"),
    action: "pay",
    amount: Number((amountMinor / 100).toFixed(2)),
    currency: "UAH",
    order_id: orderId,
    payment_id: "e2e-payment-1",
    paytype: "card",
    status: "success",
  });
  const callback = await requestForm("/integrations/payments/liqpay/callback", callbackFields);
  expectStatus(callback, 200, "LiqPay success callback");
  assert.equal(callback.payload?.ok, true);
  const duplicateCallback = await requestForm("/integrations/payments/liqpay/callback", callbackFields);
  expectStatus(duplicateCallback, 200, "duplicate LiqPay callback");
  assert.equal(duplicateCallback.payload?.duplicate, true, "duplicate callback must be idempotent");

  const afterPurchase = await request("/parent/dashboard", { cookie: parent.cookie });
  expectStatus(afterPurchase, 200, "parent dashboard after LiqPay payment");
  const purchasedEnrollment = afterPurchase.payload.students.flatMap((entry) => entry.enrollments ?? []).find((entry) => entry.id === enrollment.id);
  assert.equal(Number(purchasedEnrollment.balanceLessonUnits), initialBalance + purchaseLessons, "successful callback must grant purchased lessons exactly once");

  const parentRefundDenied = await request(`/billing/orders/${orderId}/refunds`, {
    method: "POST", cookie: parent.cookie, body: { lessonUnits: 1, idempotencyKey: randomUUID() },
  });
  expectStatus(parentRefundDenied, 403, "parent refund permission denied");

  const refundKey = randomUUID();
  const refund = await request(`/billing/orders/${orderId}/refunds`, {
    method: "POST",
    cookie: manager.cookie,
    body: { lessonUnits: 1, reason: "E2E LiqPay partial refund", idempotencyKey: refundKey },
  });
  expectStatus(refund, 201, "manager LiqPay partial refund");
  assert.equal(refund.payload?.refund?.status, "SUCCEEDED", "mock LiqPay refund must finalize");
  assert.equal(refund.payload?.refund?.orderStatus, "PARTIALLY_REFUNDED");
  const refundReplay = await request(`/billing/orders/${orderId}/refunds`, {
    method: "POST",
    cookie: manager.cookie,
    body: { lessonUnits: 1, reason: "E2E LiqPay partial refund replay", idempotencyKey: refundKey },
  });
  expectStatus(refundReplay, 201, "LiqPay refund idempotency replay");
  assert.equal(refundReplay.payload?.reused, true, "refund idempotency key must not create a second refund");

  const lateSuccessFields = liqpayCallbackFields({
    version: 7, public_key: required("LIQPAY_PUBLIC_KEY"), action: "pay",
    amount: Number((amountMinor / 100).toFixed(2)), currency: "UAH", order_id: orderId,
    payment_id: "e2e-payment-1", paytype: "card", status: "success", end_date: Date.now(),
  });
  const lateSuccess = await requestForm("/integrations/payments/liqpay/callback", lateSuccessFields);
  expectStatus(lateSuccess, 200, "late LiqPay success callback after refund");

  const historyAfterLateSuccess = await request("/parent/payments", { cookie: parent.cookie });
  expectStatus(historyAfterLateSuccess, 200, "parent payments after late LiqPay callback");
  const refundedOrder = historyAfterLateSuccess.payload.find((entry) => entry.id === orderId);
  assert.equal(refundedOrder?.status, "PARTIALLY_REFUNDED", "late success callback must not regress a refunded order to PAID");
  assert.ok(Number(refundedOrder?.refunded_minor) > 0, "refund amount must remain recorded");

  const afterRefund = await request("/parent/dashboard", { cookie: parent.cookie });
  expectStatus(afterRefund, 200, "parent dashboard after LiqPay refund");
  const refundedEnrollment = afterRefund.payload.students.flatMap((entry) => entry.enrollments ?? []).find((entry) => entry.id === enrollment.id);
  const balanceAfterLiqPay = initialBalance + purchaseLessons - 1;
  assert.equal(Number(refundedEnrollment.balanceLessonUnits), balanceAfterLiqPay, "LiqPay refund must revoke exactly the refunded lesson balance");

  // --- mono purchase: ECDSA webhook, duplicate/stale ordering, async partial refund ---
  const monoCheckout = await request(`/parent/enrollments/${enrollment.id}/checkout`, {
    method: "POST",
    cookie: parent.cookie,
    body: { lessonUnits: purchaseLessons, paymentProvider: "MONO", idempotencyKey: randomUUID() },
  });
  expectStatus(monoCheckout, 201, "parent mono checkout");
  assert.equal(monoCheckout.payload?.paymentProvider, "MONO");
  assert.equal(monoCheckout.payload?.providerCheckout?.method, "GET");
  assert.ok(monoCheckout.payload?.providerCheckout?.providerPaymentId, "mono checkout must return invoiceId");
  assert.ok(monoCheckout.payload?.providerCheckout?.checkoutUrl, "mono checkout must return pageUrl");
  const monoOrderId = monoCheckout.payload.order.id;
  const monoAmountMinor = Number(monoCheckout.payload.order.totalMinor);
  const monoInvoiceId = monoCheckout.payload.providerCheckout.providerPaymentId;

  const resumedMono = await request(`/parent/orders/${monoOrderId}/payment`, { method: "POST", cookie: parent.cookie });
  expectStatus(resumedMono, 201, "resume mono checkout");
  assert.equal(resumedMono.payload?.providerCheckout?.providerPaymentId, monoInvoiceId, "resume must reuse mono invoice instead of creating another one");

  const invalidMonoPayload = {
    invoiceId: monoInvoiceId,
    status: "processing",
    amount: monoAmountMinor,
    ccy: 980,
    finalAmount: monoAmountMinor,
    createdDate: "2026-09-23T10:00:00.000Z",
    modifiedDate: "2026-09-23T10:00:01.000Z",
  };
  const invalidSignature = await monoSignedWebhook(invalidMonoPayload, Buffer.from("bad-signature").toString("base64"));
  expectStatus(invalidSignature, 400, "mono invalid ECDSA signature denied");
  assert.equal(invalidSignature.payload?.error?.code, "MONO_SIGNATURE_INVALID");

  const monoSuccessPayload = {
    invoiceId: monoInvoiceId,
    status: "success",
    amount: monoAmountMinor,
    ccy: 980,
    finalAmount: monoAmountMinor,
    createdDate: "2026-09-23T10:00:00.000Z",
    modifiedDate: "2026-09-23T10:00:03.000Z",
    reference: monoOrderId,
    paymentInfo: { paymentMethod: "monobank" },
    cancelList: [],
  };
  const monoSuccess = await monoSignedWebhook(monoSuccessPayload);
  expectStatus(monoSuccess, 200, "mono success webhook");
  assert.equal(monoSuccess.payload?.ok, true);
  const monoDuplicate = await monoSignedWebhook(monoSuccessPayload);
  expectStatus(monoDuplicate, 200, "duplicate mono webhook");
  assert.equal(monoDuplicate.payload?.duplicate, true, "mono webhook must be idempotent");

  const staleMono = await monoSignedWebhook({
    ...monoSuccessPayload,
    status: "processing",
    modifiedDate: "2026-09-23T10:00:02.000Z",
  });
  expectStatus(staleMono, 200, "stale mono processing webhook");
  assert.equal(staleMono.payload?.ignored, true);
  assert.equal(staleMono.payload?.reason, "STALE_PROVIDER_EVENT", "older modifiedDate must not regress mono state");

  const afterMonoPurchase = await request("/parent/dashboard", { cookie: parent.cookie });
  expectStatus(afterMonoPurchase, 200, "parent dashboard after mono payment");
  const monoPurchasedEnrollment = afterMonoPurchase.payload.students.flatMap((entry) => entry.enrollments ?? []).find((entry) => entry.id === enrollment.id);
  assert.equal(Number(monoPurchasedEnrollment.balanceLessonUnits), balanceAfterLiqPay + purchaseLessons, "mono success webhook must grant lessons exactly once");

  const monoRefundKey = randomUUID();
  const monoRefund = await request(`/billing/orders/${monoOrderId}/refunds`, {
    method: "POST",
    cookie: manager.cookie,
    body: { lessonUnits: 1, reason: "E2E mono partial refund", idempotencyKey: monoRefundKey },
  });
  expectStatus(monoRefund, 201, "manager mono partial refund request");
  assert.equal(monoRefund.payload?.refund?.providerStatus, "processing", "mono mock should leave refund pending for webhook confirmation");
  const monoRefundMinor = Number(monoRefund.payload?.refund?.amountMinor);
  assert.ok(monoRefundMinor > 0, "mono refund response must expose calculated amount");

  const monoRefundWebhook = await monoSignedWebhook({
    ...monoSuccessPayload,
    finalAmount: monoAmountMinor - monoRefundMinor,
    modifiedDate: "2026-09-23T10:00:04.000Z",
    cancelList: [{
      status: "success",
      amount: monoRefundMinor,
      ccy: 980,
      createdDate: "2026-09-23T10:00:03.500Z",
      modifiedDate: "2026-09-23T10:00:04.000Z",
      extRef: monoRefundKey,
      rrn: "mono-e2e-refund-rrn",
    }],
  });
  expectStatus(monoRefundWebhook, 200, "mono refund webhook");

  const monoRefundReplay = await request(`/billing/orders/${monoOrderId}/refunds`, {
    method: "POST",
    cookie: manager.cookie,
    body: { lessonUnits: 1, reason: "E2E mono refund replay", idempotencyKey: monoRefundKey },
  });
  expectStatus(monoRefundReplay, 201, "mono refund idempotency replay");
  assert.equal(monoRefundReplay.payload?.reused, true);
  assert.equal(monoRefundReplay.payload?.refund?.status, "SUCCEEDED", "mono webhook must finalize pending refund");

  const afterMonoRefund = await request("/parent/dashboard", { cookie: parent.cookie });
  expectStatus(afterMonoRefund, 200, "parent dashboard after mono refund");
  const monoRefundedEnrollment = afterMonoRefund.payload.students.flatMap((entry) => entry.enrollments ?? []).find((entry) => entry.id === enrollment.id);
  assert.equal(Number(monoRefundedEnrollment.balanceLessonUnits), balanceAfterLiqPay + purchaseLessons - 1, "mono partial refund must revoke exactly one lesson");

  // A parent-cancelled checkout must never be resurrected by a late successful provider callback.
  const cancelledMonoCheckout = await request(`/parent/enrollments/${enrollment.id}/checkout`, {
    method: "POST",
    cookie: parent.cookie,
    body: { lessonUnits: purchaseLessons, paymentProvider: "MONO", idempotencyKey: randomUUID() },
  });
  expectStatus(cancelledMonoCheckout, 201, "parent mono checkout for cancellation regression");
  const cancelledOrderId = cancelledMonoCheckout.payload.order.id;
  const cancelledInvoiceId = cancelledMonoCheckout.payload.providerCheckout.providerPaymentId;
  const cancelledAmountMinor = Number(cancelledMonoCheckout.payload.order.totalMinor);
  const cancelled = await request(`/parent/orders/${cancelledOrderId}/cancel`, { method: "POST", cookie: parent.cookie });
  expectStatus(cancelled, 201, "parent cancels mono checkout");
  assert.equal(cancelled.payload?.status, "CANCELLED");
  assert.equal(cancelled.payload?.providerCheckoutInvalidated, true, "mono pending invoice should be invalidated at provider on local cancellation");
  const lateCancelledPayment = await monoSignedWebhook({
    invoiceId: cancelledInvoiceId,
    status: "success",
    amount: cancelledAmountMinor,
    ccy: 980,
    finalAmount: cancelledAmountMinor,
    createdDate: "2026-09-23T10:10:00.000Z",
    modifiedDate: "2026-09-23T10:10:01.000Z",
    reference: cancelledOrderId,
    paymentInfo: { paymentMethod: "monobank" },
    cancelList: [],
  });
  expectStatus(lateCancelledPayment, 200, "late mono payment for cancelled checkout");
  assert.equal(lateCancelledPayment.payload?.ignored, true);
  assert.equal(lateCancelledPayment.payload?.reason, "PAYMENT_FOR_CANCELLED_ORDER_REQUIRES_RECONCILIATION");
  const afterCancelledLatePayment = await request("/parent/dashboard", { cookie: parent.cookie });
  expectStatus(afterCancelledLatePayment, 200, "parent dashboard after cancelled late payment");
  const cancellationRegressionEnrollment = afterCancelledLatePayment.payload.students.flatMap((entry) => entry.enrollments ?? []).find((entry) => entry.id === enrollment.id);
  assert.equal(Number(cancellationRegressionEnrollment.balanceLessonUnits), balanceAfterLiqPay + purchaseLessons - 1, "cancelled checkout callback must not grant lessons");

  // The intentionally-created cancelled-payment edge case must surface in operations and be explicitly reconciled.
  const parentReconciliationDenied = await request("/ops/payment-reconciliation", { cookie: parent.cookie });
  expectStatus(parentReconciliationDenied, 403, "parent reconciliation permission denied");
  const reconciliationBefore = await request("/ops/payment-reconciliation", { cookie: manager.cookie });
  expectStatus(reconciliationBefore, 200, "manager payment reconciliation list");
  const reconciliationEvent = reconciliationBefore.payload.find((entry) => entry.order_id === cancelledOrderId);
  assert.ok(reconciliationEvent?.id, "cancelled late payment must create a reconciliation event");
  assert.equal(reconciliationEvent.processing_error, "PAYMENT_FOR_CANCELLED_ORDER_REQUIRES_RECONCILIATION");
  const resolvedReconciliation = await request(`/ops/payment-reconciliation/${reconciliationEvent.id}/resolve`, {
    method: "POST", cookie: manager.cookie, body: { note: "E2E verified: cancelled order received a late provider success; no credits were granted." },
  });
  expectStatus(resolvedReconciliation, 201, "manager resolves payment reconciliation");
  assert.ok(resolvedReconciliation.payload?.reconciled_at, "resolved reconciliation must record a timestamp");
  const reconciliationAfter = await request("/ops/payment-reconciliation", { cookie: manager.cookie });
  expectStatus(reconciliationAfter, 200, "manager payment reconciliation list after resolve");
  assert.equal(reconciliationAfter.payload.some((entry) => entry.id === reconciliationEvent.id), false, "resolved event must leave the unresolved queue");

  const student = await login(accounts.student);
  const studentDashboard = await request("/student/dashboard", { cookie: student.cookie });
  expectStatus(studentDashboard, 200, "student dashboard");
  assert.ok(studentDashboard.payload?.enrollments?.length >= 1, "student fixture must expose an active enrollment");
  const studentCourses = await request("/portal/courses", { cookie: student.cookie });
  expectStatus(studentCourses, 200, "student course portal");
  assert.ok(Array.isArray(studentCourses.payload), "student course portal must return an array");
  const studentAsParent = await request("/parent/dashboard", { cookie: student.cookie });
  expectStatus(studentAsParent, 403, "student cannot use parent dashboard");
  assert.equal(studentAsParent.payload?.error?.code, "PARENT_PORTAL_ONLY");
  expectStatus(await request("/ops/dashboard", { cookie: student.cookie }), 403, "student operations denied");

  const logout = await request("/auth/logout", { method: "POST", cookie: manager.cookie });
  expectStatus(logout, 201, "manager logout");
  expectStatus(await request("/auth/me", { cookie: manager.cookie }), 401, "revoked manager session");

  console.log("E2E API flow: PASS (roles + LiqPay + mono checkout/webhook/order/refund hardening)");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
