"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { dateTime, money } from "../lib/format";
import { PlatformShell } from "./platform-shell";

function paymentStatusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    PAID: "Сплачено",
    SUCCEEDED: "Успішно",
    PENDING_PAYMENT: "Очікує оплату",
    PARTIALLY_REFUNDED: "Частково повернено",
    REFUNDED: "Повернено",
    CANCELLED: "Скасовано",
    FAILED: "Помилка",
  };
  return status ? (labels[status] ?? status) : "—";
}

function paymentMethodLabel(method?: string | null) {
  const labels: Record<string, string> = {
    CARD: "Картка",
    BANK_TRANSFER: "Банківський переказ",
    CASH: "Готівка",
    OTHER: "Інше",
  };
  return method ? (labels[method] ?? method) : "—";
}

function providerStatusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    success: "Підтверджено провайдером",
    refund_success: "Повернення підтверджено",
    processing: "В обробці",
    failure: "Відхилено провайдером",
    expired: "Термін оплати минув",
    reversed: "Повернено провайдером",
  };
  return status ? (labels[String(status).toLowerCase()] ?? status) : "—";
}

function reconciliationReasonLabel(reason?: string | null) {
  const labels: Record<string, string> = {
    PAYMENT_REFERENCE_MISMATCH: "Посилання платежу не збігається із замовленням",
    PAYMENT_AMOUNT_OR_CURRENCY_MISMATCH: "Сума або валюта не збігається із замовленням",
    PAYMENT_FOR_CANCELLED_ORDER_REQUIRES_RECONCILIATION: "Платіж надійшов для скасованого замовлення",
    REFUND_REQUIRES_RECONCILIATION: "Повернення потребує ручної звірки",
    EXTERNAL_REFUND_REQUIRES_RECONCILIATION: "Провайдер повідомив про зовнішнє повернення",
    STALE_PROVIDER_EVENT: "Отримано застарілу подію провайдера",
    PAYMENT_NOT_FOUND: "Платіж для події не знайдено",
  };
  return reason ? (labels[reason] ?? reason) : "—";
}

export function PaymentsPage({ role }: { role: "ADMIN" | "MANAGER" }) {
  const [rows, setRows] = useState<any[]>([]);
  const [reconciliation, setReconciliation] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [refundPayment, setRefundPayment] = useState<any | null>(null);
  const [refundUnits, setRefundUnits] = useState("1");
  const [refundReason, setRefundReason] = useState("Повернення невикористаних занять");
  const [reconciliationEvent, setReconciliationEvent] = useState<any | null>(null);
  const [reconciliationNote, setReconciliationNote] = useState("Перевірено менеджером; фінансовий стан звірено з провайдером.");

  async function load() {
    setLoading(true); setError("");
    try {
      const [payments, reconciliationRows] = await Promise.all([
        api<any[]>("/ops/payments?limit=250"),
        api<any[]>("/ops/payment-reconciliation?limit=100"),
      ]);
      setRows(payments);
      setReconciliation(reconciliationRows);
    }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  function openReconciliation(event: any) {
    setReconciliationEvent(event);
    setReconciliationNote("Перевірено менеджером; фінансовий стан звірено з провайдером.");
    setError("");
    setMsg("");
  }

  async function resolveReconciliation(event: FormEvent) {
    event.preventDefault();
    if (!reconciliationEvent) return;
    setBusy(true); setError(""); setMsg("");
    try {
      await api(`/ops/payment-reconciliation/${reconciliationEvent.id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ note: reconciliationNote.trim() || undefined }),
      });
      setMsg("Подію звірено й закрито.");
      setReconciliationEvent(null);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function openRefund(payment: any) {
    const max = Number(payment.refundable_lesson_units ?? 0);
    setRefundPayment(payment);
    setRefundUnits(String(Math.min(1, max)));
    setRefundReason("Повернення невикористаних занять");
    setError("");
    setMsg("");
  }

  async function refund(event: FormEvent) {
    event.preventDefault();
    if (!refundPayment) return;
    const max = Number(refundPayment.refundable_lesson_units ?? 0);
    const lessonUnits = Number(refundUnits.replace(",", "."));
    if (!Number.isFinite(lessonUnits) || lessonUnits <= 0 || lessonUnits > max || !Number.isInteger(lessonUnits * 2)) {
      setError(`Вкажіть значення від 0.5 до ${max} з кроком 0.5.`);
      return;
    }
    setBusy(true); setError(""); setMsg("");
    try {
      await api(`/billing/orders/${refundPayment.id}/refunds`, {
        method: "POST",
        body: JSON.stringify({ lessonUnits, reason: refundReason.trim() || undefined, idempotencyKey: crypto.randomUUID() }),
      });
      setMsg(`Повернення ${lessonUnits} занять передано на обробку.`);
      setRefundPayment(null);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return <PlatformShell allowedRoles={role === "ADMIN" ? ["ADMIN"] : ["MANAGER"]}>
    <div className="page-head finance-page-head"><div><h1>Оплати</h1><p className="muted">Надходження сімей, статуси провайдера й повернення невикористаних занять.</p></div></div>
    {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
    {msg && <div className="success" style={{ marginBottom: 12 }}>{msg}</div>}
    {loading ? <div className="card">Завантаження…</div> : rows.length === 0 ? <div className="card empty">Оплат за обраний період поки немає.</div> : <div className="table-wrap"><table><thead><tr><th>Дата</th><th>Сімʼя / учень</th><th>Предмет</th><th>Кількість</th><th>Сума</th><th>Метод</th><th>Статус</th><th></th></tr></thead><tbody>{rows.map((p) => {
      const refunded = Number(p.refunded_minor ?? 0);
      const refundable = Number(p.refundable_lesson_units ?? 0);
      const canRefund = ["LIQPAY", "MONO"].includes(p.provider) && ["PAID", "PARTIALLY_REFUNDED"].includes(p.status) && refundable >= 0.5;
      return <tr key={p.id}><td>{dateTime(p.paid_at ?? p.created_at)}</td><td>{p.parent_last_name} {p.parent_first_name}<br/><span className="muted">{p.student_last_name} {p.student_first_name}</span></td><td>{p.subject_name ?? "Курс/інше"}</td><td>{p.lesson_units ?? "—"}{refundable > 0 && <><br/><small className="muted">можна повернути: {refundable}</small></>}</td><td><strong>{money(p.total_minor, p.currency)}</strong>{refunded > 0 && <><br/><small className="muted">повернено {money(refunded, p.currency)}</small></>}</td><td>{paymentMethodLabel(p.method)}{p.provider && <><br/><small className="muted">{p.provider}</small></>}</td><td><span className={`badge ${p.status === "PAID" ? "paid" : p.status === "PARTIALLY_REFUNDED" ? "booked" : ""}`}>{paymentStatusLabel(p.status)}</span>{p.provider_status && <><br/><small className="muted">{providerStatusLabel(p.provider_status)}</small></>}</td><td>{canRefund && <button className="btn secondary" disabled={busy} onClick={() => openRefund(p)}>Повернення</button>}</td></tr>;
    })}</tbody></table></div>}
    {refundPayment && <div className="sheet-backdrop" onClick={() => !busy && setRefundPayment(null)}>
      <aside className="sheet refund-sheet" onClick={(event) => event.stopPropagation()}>
        <button className="sheet-close" type="button" aria-label="Закрити" disabled={busy} onClick={() => setRefundPayment(null)}>×</button>
        <div className="refund-sheet-head">
          <span className="refund-sheet-kicker">Фінансова операція</span>
          <h2>Повернення коштів</h2>
          <p className="muted">Повернути можна лише невикористані заняття з цієї онлайн-покупки.</p>
        </div>

        <div className="refund-payment-summary">
          <div><span className="muted">Сімʼя / учень</span><strong>{refundPayment.parent_last_name} {refundPayment.parent_first_name}</strong><small>{refundPayment.student_last_name} {refundPayment.student_first_name}</small></div>
          <div><span className="muted">Предмет</span><strong>{refundPayment.subject_name ?? "—"}</strong></div>
          <div><span className="muted">Оплачено</span><strong>{money(refundPayment.total_minor, refundPayment.currency)}</strong></div>
          <div><span className="muted">Доступно до повернення</span><strong>{Number(refundPayment.refundable_lesson_units ?? 0)} зан.</strong></div>
        </div>

        <form className="stack refund-form" onSubmit={refund}>
          <div className="field">
            <label htmlFor="refund-units">Кількість занять</label>
            <input id="refund-units" className="input" inputMode="decimal" value={refundUnits} onChange={(event) => setRefundUnits(event.target.value)} disabled={busy} />
            <span className="field-hint">Крок 0.5 · максимум {Number(refundPayment.refundable_lesson_units ?? 0)}</span>
          </div>
          <div className="field">
            <label htmlFor="refund-reason">Причина повернення</label>
            <textarea id="refund-reason" className="input refund-reason-input" value={refundReason} onChange={(event) => setRefundReason(event.target.value)} disabled={busy} />
          </div>
          <div className="refund-warning">
            Після підтвердження платіжним провайдером відповідна кількість невикористаних занять буде списана з балансу. Для Monobank повернення може спочатку мати статус «в обробці».
          </div>
          <div className="refund-sheet-actions">
            <button className="btn secondary" type="button" disabled={busy} onClick={() => setRefundPayment(null)}>Скасувати</button>
            <button className="btn danger" type="submit" disabled={busy}>{busy ? "Обробляємо…" : "Повернути кошти"}</button>
          </div>
        </form>
      </aside>
    </div>}

    {reconciliationEvent && <div className="sheet-backdrop" onClick={() => !busy && setReconciliationEvent(null)}>
      <aside className="sheet reconciliation-sheet" onClick={(event) => event.stopPropagation()}>
        <button className="sheet-close" type="button" aria-label="Закрити" disabled={busy} onClick={() => setReconciliationEvent(null)}>×</button>
        <div className="refund-sheet-head">
          <span className="refund-sheet-kicker">Контроль платежів</span>
          <h2>Звірка з провайдером</h2>
          <p className="muted">Перед закриттям події перевірте стан платежу у провайдера, замовлення, повернення та баланс занять.</p>
        </div>

        <div className="reconciliation-summary">
          <div><span className="muted">Провайдер</span><strong>{reconciliationEvent.provider}</strong><small>{providerStatusLabel(reconciliationEvent.provider_status)}</small></div>
          <div><span className="muted">Сімʼя / учень</span><strong>{reconciliationEvent.parent_last_name ?? ""} {reconciliationEvent.parent_first_name ?? ""}</strong><small>{reconciliationEvent.student_last_name ?? ""} {reconciliationEvent.student_first_name ?? ""}</small></div>
          <div><span className="muted">Замовлення</span><strong><code>{reconciliationEvent.order_id ? String(reconciliationEvent.order_id).slice(0, 8) : "—"}</code></strong><small>{paymentStatusLabel(reconciliationEvent.order_status)} / {paymentStatusLabel(reconciliationEvent.payment_status)}</small></div>
          <div><span className="muted">Причина</span><strong>{reconciliationReasonLabel(reconciliationEvent.processing_error)}</strong><small>{reconciliationEvent.processing_error}</small></div>
        </div>

        <form className="stack refund-form" onSubmit={resolveReconciliation}>
          <div className="field">
            <label htmlFor="reconciliation-note">Як вирішено подію</label>
            <textarea id="reconciliation-note" className="input reconciliation-note-input" value={reconciliationNote} onChange={(event) => setReconciliationNote(event.target.value)} disabled={busy} />
            <span className="field-hint">Цей коментар залишиться в історії звірки.</span>
          </div>
          <div className="refund-warning">
            Закривайте подію лише після фактичної звірки з провайдером. Кнопка не змінює платіж автоматично — вона фіксує, що розбіжність перевірена вручну.
          </div>
          <div className="refund-sheet-actions">
            <button className="btn secondary" type="button" disabled={busy} onClick={() => setReconciliationEvent(null)}>Скасувати</button>
            <button className="btn" type="submit" disabled={busy}>{busy ? "Зберігаємо…" : "Позначити звіреною"}</button>
          </div>
        </form>
      </aside>
    </div>}

    {!loading && <div className="reconciliation-section">
      <div className="page-head"><div><h2>Звірка з платіжними провайдерами</h2><p className="muted">Події, що потребують ручної перевірки. Перед закриттям звірте платіж у банку, замовлення, повернення та баланс занять.</p></div><span className={`badge ${reconciliation.length ? "booked" : "paid"}`}>{reconciliation.length}</span></div>
      {reconciliation.length === 0 ? <div className="card empty">Невирішених подій немає.</div> : <div className="table-wrap"><table><thead><tr><th>Отримано</th><th>Провайдер</th><th>Сімʼя / учень</th><th>Замовлення</th><th>Причина</th><th></th></tr></thead><tbody>{reconciliation.map((event) => <tr key={event.id}>
        <td>{dateTime(event.received_at)}</td>
        <td>{event.provider}<br/><small className="muted">{providerStatusLabel(event.provider_status)}</small></td>
        <td>{event.parent_last_name ?? ""} {event.parent_first_name ?? ""}<br/><small className="muted">{event.student_last_name ?? ""} {event.student_first_name ?? ""}</small></td>
        <td><code>{event.order_id ? String(event.order_id).slice(0, 8) : "—"}</code><br/><small className="muted">{paymentStatusLabel(event.order_status)} / {paymentStatusLabel(event.payment_status)}</small></td>
        <td><span className="reconciliation-reason">{reconciliationReasonLabel(event.processing_error)}</span><br/><small className="muted">{event.processing_error}</small></td>
        <td><button className="btn secondary" disabled={busy} onClick={() => openReconciliation(event)}>Звірити</button></td>
      </tr>)}</tbody></table></div>}
    </div>}
  </PlatformShell>;
}
