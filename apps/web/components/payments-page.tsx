"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { dateTime, money } from "../lib/format";
import { PlatformShell } from "./platform-shell";

export function PaymentsPage({ role }: { role: "ADMIN" | "MANAGER" }) {
  const [rows, setRows] = useState<any[]>([]);
  const [reconciliation, setReconciliation] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

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

  async function resolveReconciliation(event: any) {
    const note = window.prompt("Як вирішено цю подію?", "Перевірено менеджером; фінансовий стан звірено з провайдером.");
    if (note == null) return;
    setBusy(true); setError(""); setMsg("");
    try {
      await api(`/ops/payment-reconciliation/${event.id}/resolve`, {
        method: "POST",
        body: JSON.stringify({ note: note || undefined }),
      });
      setMsg("Подію звірено й закрито.");
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function refund(payment: any) {
    const max = Number(payment.refundable_lesson_units ?? 0);
    const raw = window.prompt(`Скільки занять повернути? Доступно: ${max}. Крок: 0.5`, String(Math.min(1, max)));
    if (raw == null) return;
    const lessonUnits = Number(raw.replace(",", "."));
    if (!Number.isFinite(lessonUnits) || lessonUnits <= 0 || lessonUnits > max || !Number.isInteger(lessonUnits * 2)) {
      setError(`Вкажіть значення від 0.5 до ${max} з кроком 0.5.`);
      return;
    }
    const reason = window.prompt("Причина повернення (необовʼязково)", "Повернення невикористаних занять") ?? undefined;
    setBusy(true); setError(""); setMsg("");
    try {
      await api(`/billing/orders/${payment.id}/refunds`, {
        method: "POST",
        body: JSON.stringify({ lessonUnits, reason: reason || undefined, idempotencyKey: crypto.randomUUID() }),
      });
      setMsg(`Повернення ${lessonUnits} занять оброблено.`);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return <PlatformShell allowedRoles={role === "ADMIN" ? ["ADMIN"] : ["MANAGER"]}>
    <div className="page-head"><div><h1>Оплати</h1><p className="muted">Надходження сімей, статуси провайдера й повернення невикористаних занять.</p></div></div>
    {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
    {msg && <div className="success" style={{ marginBottom: 12 }}>{msg}</div>}
    {loading ? <div className="card">Завантаження…</div> : rows.length === 0 ? <div className="card empty">Оплат за обраний період поки немає.</div> : <div className="table-wrap"><table><thead><tr><th>Дата</th><th>Сімʼя / учень</th><th>Предмет</th><th>Кількість</th><th>Сума</th><th>Метод</th><th>Статус</th><th></th></tr></thead><tbody>{rows.map((p) => {
      const refunded = Number(p.refunded_minor ?? 0);
      const refundable = Number(p.refundable_lesson_units ?? 0);
      const canRefund = ["LIQPAY", "MONO"].includes(p.provider) && ["PAID", "PARTIALLY_REFUNDED"].includes(p.status) && refundable >= 0.5;
      return <tr key={p.id}><td>{dateTime(p.paid_at ?? p.created_at)}</td><td>{p.parent_last_name} {p.parent_first_name}<br/><span className="muted">{p.student_last_name} {p.student_first_name}</span></td><td>{p.subject_name ?? "Курс/інше"}</td><td>{p.lesson_units ?? "—"}{refundable > 0 && <><br/><small className="muted">можна повернути: {refundable}</small></>}</td><td><strong>{money(p.total_minor, p.currency)}</strong>{refunded > 0 && <><br/><small className="muted">повернено {money(refunded, p.currency)}</small></>}</td><td>{p.method ?? "—"}{p.provider && <><br/><small className="muted">{p.provider}</small></>}</td><td><span className="badge">{p.status}</span>{p.provider_status && <><br/><small className="muted">{p.provider_status}</small></>}</td><td>{canRefund && <button className="btn secondary" disabled={busy} onClick={() => void refund(p)}>Повернення</button>}</td></tr>;
    })}</tbody></table></div>}
    {!loading && <div style={{ marginTop: 24 }}>
      <div className="page-head"><div><h2>Звірка з платіжними провайдерами</h2><p className="muted">Події, що потребують ручної перевірки. Перед закриттям звірте платіж у банку, замовлення, повернення та баланс занять.</p></div><span className="badge">{reconciliation.length}</span></div>
      {reconciliation.length === 0 ? <div className="card empty">Невирішених подій немає.</div> : <div className="table-wrap"><table><thead><tr><th>Отримано</th><th>Провайдер</th><th>Сімʼя / учень</th><th>Замовлення</th><th>Причина</th><th></th></tr></thead><tbody>{reconciliation.map((event) => <tr key={event.id}>
        <td>{dateTime(event.received_at)}</td>
        <td>{event.provider}<br/><small className="muted">{event.provider_status ?? "—"}</small></td>
        <td>{event.parent_last_name ?? ""} {event.parent_first_name ?? ""}<br/><small className="muted">{event.student_last_name ?? ""} {event.student_first_name ?? ""}</small></td>
        <td><code>{event.order_id ? String(event.order_id).slice(0, 8) : "—"}</code><br/><small className="muted">{event.order_status ?? "—"} / {event.payment_status ?? "—"}</small></td>
        <td><code>{event.processing_error}</code></td>
        <td><button className="btn secondary" disabled={busy} onClick={() => void resolveReconciliation(event)}>Звірено</button></td>
      </tr>)}</tbody></table></div>}
    </div>}
  </PlatformShell>;
}
