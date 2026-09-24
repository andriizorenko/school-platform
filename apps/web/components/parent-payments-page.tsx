"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { dateTime, money } from "../lib/format";
import { PlatformShell } from "./platform-shell";

type ProviderCheckout = {
  provider: "LIQPAY" | "MONO";
  checkoutUrl: string;
  method: "GET" | "POST";
  fields?: Record<string, string>;
  providerPaymentId?: string;
};

function providerLabel(provider?: string | null) {
  if (provider === "MONO") return "mono";
  if (provider === "LIQPAY") return "LiqPay";
  return provider ?? "платіжну систему";
}

function orderStatusLabel(status: string) {
  if (status === "PAID") return "Сплачено";
  if (status === "PENDING_PAYMENT") return "Очікує оплату";
  if (status === "PARTIALLY_REFUNDED") return "Частково повернено";
  if (status === "REFUNDED") return "Повернено";
  if (status === "CANCELLED") return "Скасовано";
  return status;
}

export function ParentPaymentsPage() {
  const [dash, setDash] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [config, setConfig] = useState<any>({ minimumLessonUnits: 10, paymentIntegrationReady: false });
  const [selectedEnrollment, setSelectedEnrollment] = useState("");
  const [lessonUnits, setLessonUnits] = useState(10);
  const [promotionCode, setPromotionCode] = useState("");
  const [paymentProvider, setPaymentProvider] = useState<"LIQPAY" | "MONO" | "">("");
  const [quote, setQuote] = useState<any>(null);
  const [providerCheckout, setProviderCheckout] = useState<ProviderCheckout | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const enrollments = useMemo(() => {
    const out: any[] = [];
    for (const student of dash?.students ?? []) {
      for (const enrollment of student.enrollments ?? []) {
        if (enrollment.status === "ACTIVE") out.push({ ...enrollment, student });
      }
    }
    return out;
  }, [dash]);

  async function load() {
    setError("");
    try {
      const [d, p, c] = await Promise.all([
        api<any>("/parent/dashboard"),
        api<any[]>("/parent/payments"),
        api<any>("/parent/checkout/config"),
      ]);
      setDash(d);
      setRows(p);
      setConfig(c);
      setPaymentProvider((current) => current || c.paymentProvider || c.paymentProviders?.[0] || "");
      setLessonUnits((current) => Math.max(current, Number(c.minimumLessonUnits ?? 10)));
      setSelectedEnrollment((current) => current || d.students?.flatMap((s: any) =>
        (s.enrollments ?? []).filter((e: any) => e.status === "ACTIVE").map((e: any) => e.id),
      )?.[0] || "");
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => { setQuote(null); setProviderCheckout(null); }, [selectedEnrollment, lessonUnits, promotionCode, paymentProvider]);

  async function calculate(e?: FormEvent) {
    e?.preventDefault();
    if (!selectedEnrollment) return;
    setBusy(true); setError(""); setMsg(""); setProviderCheckout(null);
    try {
      const params = new URLSearchParams({ lessonUnits: String(lessonUnits) });
      if (promotionCode.trim()) params.set("promotionCode", promotionCode.trim());
      setQuote(await api<any>(`/parent/enrollments/${selectedEnrollment}/checkout/quote?${params}`));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function createCheckout() {
    if (!selectedEnrollment) return;
    setBusy(true); setError(""); setMsg("");
    try {
      const payload = {
        lessonUnits,
        promotionCode: promotionCode.trim() || undefined,
        paymentProvider: paymentProvider || undefined,
        idempotencyKey: crypto.randomUUID(),
      };
      const result = await api<any>(`/parent/enrollments/${selectedEnrollment}/checkout`, { method: "POST", body: JSON.stringify(payload) });
      if (result.providerCheckout) {
        setProviderCheckout(result.providerCheckout);
        setMsg(`Замовлення створено. Натисніть «Оплатити через ${providerLabel(result.paymentProvider)}», щоб перейти на захищену сторінку оплати.`);
      } else if (result.nextStep === "COMPLETED") {
        setMsg("Замовлення завершено. Баланс занять оновлено.");
      } else {
        setMsg("Замовлення сформовано, але платіжний провайдер зараз недоступний. Баланс не змінено.");
      }
      setQuote(null);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function resumePayment(orderId: string) {
    setBusy(true); setError(""); setMsg("");
    try {
      const result = await api<any>(`/parent/orders/${orderId}/payment`, { method: "POST" });
      if (result.providerCheckout) {
        setProviderCheckout(result.providerCheckout);
        setMsg(`Оплата готова. Натисніть кнопку ${providerLabel(result.paymentProvider)} вище.`);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else if (result.nextStep === "COMPLETED") {
        setMsg("Це замовлення вже завершено.");
        await load();
      } else {
        setMsg("Платіжний провайдер зараз недоступний. Спробуйте пізніше.");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function submitProviderCheckout() {
    if (!providerCheckout) return;
    if (providerCheckout.method === "GET") {
      window.location.assign(providerCheckout.checkoutUrl);
      return;
    }
    const form = document.createElement("form");
    form.method = providerCheckout.method;
    form.action = providerCheckout.checkoutUrl;
    for (const [name, value] of Object.entries(providerCheckout.fields ?? {})) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  }

  async function cancel(orderId: string) {
    setBusy(true); setError("");
    try {
      await api(`/parent/orders/${orderId}/cancel`, { method: "POST" });
      setMsg("Замовлення скасовано.");
      if (providerCheckout) setProviderCheckout(null);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const selected = enrollments.find((e) => e.id === selectedEnrollment);

  return <PlatformShell allowedRoles={["PARENT"]}>
    <div className="page-head"><div><h1>Оплати</h1><p className="muted">Поповнення занять і повна історія оплат сімʼї.</p></div></div>
    {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
    {msg && <div className="success" style={{ marginBottom: 12 }}>{msg}</div>}
    {providerCheckout && <div className="card" style={{ marginBottom: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div><strong>Оплата через {providerLabel(providerCheckout.provider)} готова</strong><br/><span className="muted">Заняття будуть зараховані після підтвердження платежу платіжною системою.</span></div>
        <button className="btn" disabled={busy} onClick={submitProviderCheckout}>Оплатити через {providerLabel(providerCheckout.provider)}</button>
      </div>
    </div>}

    <div className="checkout-grid" style={{ marginBottom: 22 }}>
      <form className="card checkout-card" onSubmit={calculate}>
        <div><h2>Купити заняття</h2><p className="muted">Онлайн можна придбати будь-яку кількість від {config.minimumLessonUnits} занять.</p></div>
        <div className="field"><label>Учень і предмет</label><select className="select" value={selectedEnrollment} onChange={(e) => setSelectedEnrollment(e.target.value)} required><option value="">Оберіть</option>{enrollments.map((e) => <option value={e.id} key={e.id}>{e.student.lastName} {e.student.firstName} · {e.subject.name}</option>)}</select></div>
        <div className="grid cols-2"><div className="field"><label>Кількість занять</label><input className="input" type="number" min={config.minimumLessonUnits} step="1" value={lessonUnits} onChange={(e) => setLessonUnits(Number(e.target.value))}/></div><div className="field"><label>Промокод</label><input className="input" value={promotionCode} onChange={(e) => setPromotionCode(e.target.value.toUpperCase())} placeholder="Необовʼязково"/></div></div>
        {(config.paymentProviders?.length ?? 0) > 0 && <div className="field"><label htmlFor="payment-provider">Спосіб оплати</label><select id="payment-provider" className="select" value={paymentProvider} onChange={(e) => setPaymentProvider(e.target.value as "LIQPAY" | "MONO")}><option value="">Оберіть платіжну систему</option>{(config.paymentProviders ?? []).map((provider: string) => <option key={provider} value={provider}>{providerLabel(provider)}</option>)}</select></div>}
        {selected && <div className="row"><span className="badge">Залишок: {selected.balanceLessonUnits} занять</span>{selected.primaryTeacher && <span className="muted">Викладач: {selected.primaryTeacher.lastName} {selected.primaryTeacher.firstName}</span>}</div>}
        <button className="btn secondary" disabled={!selectedEnrollment || busy}>{busy ? "Рахуємо…" : "Розрахувати суму"}</button>
        {quote && <div className="checkout-quote"><div className="row" style={{ justifyContent: "space-between" }}><span className="muted">Базова сума</span><strong>{money(quote.baseMinor, quote.currency)}</strong></div>{quote.discountMinor > 0 && <div className="row checkout-discount" style={{ justifyContent: "space-between" }}><span>{quote.promotion?.name ?? "Знижка"}</span><span>− {money(quote.discountMinor, quote.currency)}</span></div>}<div className="checkout-total"><div><span className="muted">До оплати</span><br/><small className="muted">{lessonUnits} × {money(quote.unitPriceMinor, quote.currency)}</small></div><strong>{money(quote.totalMinor, quote.currency)}</strong></div><button type="button" className="btn" disabled={busy} onClick={() => void createCheckout()}>Підготувати оплату</button></div>}
        {config.paymentIntegrationReady
          ? <div className="pending-checkout-note"><strong>Онлайн-оплата: {(config.paymentProviders ?? []).map(providerLabel).join(" / ")}.</strong><br/>Баланс поповнюється лише після підтвердження платежу платіжною системою.</div>
          : <div className="pending-checkout-note"><strong>Онлайн-платежі зараз не налаштовані.</strong><br/>Замовлення можна сформувати, але баланс не зміниться без підтвердженої оплати.</div>}
      </form>
      <div className="card checkout-card"><div><h2>Як працює баланс</h2><p className="muted">Нові покупки завжди йдуть за тарифом, чинним у момент покупки. Уже придбані заняття при зміні ціни не перераховуються.</p></div><div className="stack"><div className="checkout-quote"><strong>60 хв = 1 заняття</strong><span className="muted">30 хв = 0.5 заняття і 50% ціни 60 хв.</span></div><div className="checkout-quote"><strong>Повернення лише невикористаного залишку</strong><span className="muted">При підтвердженому поверненні відповідна кількість невикористаних занять автоматично списується з балансу.</span></div><div className="checkout-quote"><strong>Єдиний баланс</strong><span className="muted">Після нової покупки заняття додаються до поточного залишку, а не створюють окремий абонемент.</span></div></div></div>
    </div>

    <div className="section-heading"><h2>Історія</h2><p className="muted">Успішні платежі, повернення та сформовані замовлення на оплату.</p></div>
    <div className="table-wrap"><table><thead><tr><th>Дата</th><th>Що</th><th>Учень</th><th>Сума</th><th>Акція</th><th>Статус</th><th></th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td>{dateTime(r.paid_at ?? r.created_at)}</td><td>{r.product_type === "LESSONS" ? `${r.subject_name} · ${r.lesson_units} занять` : r.product_type === "COURSE" ? r.course_title : "Інше"}<br/>{r.payment_provider && <small className="muted">{r.payment_provider}{r.payment_provider_status ? ` · ${r.payment_provider_status}` : ""}</small>}</td><td>{r.student_last_name ?? ""} {r.student_first_name ?? ""}</td><td><strong>{money(r.total_minor, r.currency)}</strong>{Number(r.discount_minor) > 0 && <><br/><small className="checkout-discount">знижка {money(r.discount_minor, r.currency)}</small></>}{Number(r.refunded_minor) > 0 && <><br/><small className="muted">повернено {money(r.refunded_minor, r.currency)}</small></>}</td><td>{r.promotion_name ?? "—"}</td><td><span className={`badge ${r.status === "PAID" ? "paid" : r.status === "PENDING_PAYMENT" ? "booked" : ""}`}>{orderStatusLabel(r.status)}</span></td><td>{r.status === "PENDING_PAYMENT" && <div className="row"><button className="btn" disabled={busy} onClick={() => void resumePayment(r.id)}>Оплатити</button><button className="btn secondary" disabled={busy} onClick={() => void cancel(r.id)}>Скасувати</button></div>}</td></tr>)}{!rows.length && <tr><td colSpan={7}><div className="empty">Оплат ще немає.</div></td></tr>}</tbody></table></div>
  </PlatformShell>;
}
