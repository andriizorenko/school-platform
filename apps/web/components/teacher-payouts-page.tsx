"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api";
import { dateOnly, money } from "../lib/format";
import { ErrorCard, LoadingCard } from "./loadable";
import { PlatformShell } from "./platform-shell";

const statusLabel: Record<string, string> = { PENDING: "Очікує реквізити", READY: "Готується до виплати", PAID: "Виплачено" };
const typeLabel: Record<string, string> = {
  REGULAR_60: "Регулярне 60 хв",
  REGULAR_30: "Регулярне 30 хв",
  FIRST_LESSON: "Перше заняття",
  PAID_STUDENT_NO_SHOW: "Оплачений пропуск",
  COMPENSATION: "Компенсаційне",
  ADJUSTMENT: "Коригування",
};

export function TeacherPayoutsPage() {
  const [data, setData] = useState<any>(null);
  const [statement, setStatement] = useState<any>(null);
  const [details, setDetails] = useState<any>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [destinationType, setDestinationType] = useState("CARD");
  const [destinationDetails, setDestinationDetails] = useState("");
  const [maskedDisplay, setMaskedDisplay] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const [payouts, profile] = await Promise.all([api<any>("/payroll/me"), api<any>("/teachers/me/profile")]);
      setData(payouts);
      const detailsResult = await api<any>(`/payroll/teachers/${profile.userId}/details`).catch(() => null);
      setDetails(detailsResult);
      setDestinationType(detailsResult?.destinationType ?? "CARD");
      setDestinationDetails(detailsResult?.details ?? "");
      setMaskedDisplay(detailsResult?.maskedDisplay ?? "");
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function loadStatement(event?: FormEvent) {
    event?.preventDefault();
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    try {
      setStatement(await api<any>(`/payroll/me/statement?${params.toString()}`));
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function saveDetails(event: FormEvent) {
    event.preventDefault();
    try {
      const profile = await api<any>("/teachers/me/profile");
      await api(`/payroll/teachers/${profile.userId}/details`, {
        method: "PUT",
        body: JSON.stringify({ destinationType, details: destinationDetails, maskedDisplay }),
      });
      setMessage("Реквізити збережено. Усі ще не виплачені рядки оновлено новими реквізитами.");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <PlatformShell allowedRoles={["TEACHER"]}>
      <div className="page-head">
        <div>
          <h1>Виплати</h1>
          <p className="muted">Поточний 14-денний період, історія виплат, коригування та виписка за довільні дати.</p>
        </div>
      </div>

      {message && <div className="success">{message}</div>}
      {loading ? <LoadingCard /> : error ? <ErrorCard error={error} /> : data && (
        <div className="stack">
          <div className="grid cols-3">
            <div className="card">
              <div className="muted">Поточний період</div>
              <div className="metric">{money(data.currentPeriodAccruedMinor)}</div>
              {data.currentPeriod && <div className="muted">{dateOnly(data.currentPeriod.period_start)} — {dateOnly(data.currentPeriod.period_end)}</div>}
            </div>
            <div className="card">
              <div className="muted">Коригування минулих періодів</div>
              <div className="metric">{money(data.pendingAdjustmentsMinor)}</div>
              <div className="muted">Будуть враховані в найближчій виплаті, яку ще не закрито.</div>
            </div>
            <div className="card">
              <div className="muted">Очікує на виплату</div>
              <div className="metric">{money(data.currentAccruedMinor)}</div>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead><tr><th>Період</th><th>Сума</th><th>Вікно виплати</th><th>Статус</th></tr></thead>
              <tbody>{data.payouts.map((payout: any) => (
                <tr key={payout.id}>
                  <td>{dateOnly(payout.period_start)} — {dateOnly(payout.period_end)}</td>
                  <td>{money(payout.amount_snapshot_minor)}</td>
                  <td>{dateOnly(payout.payout_window_start)} — {dateOnly(payout.payout_window_end)}</td>
                  <td><span className={`badge ${payout.status === "PAID" ? "paid" : "booked"}`}>{statusLabel[payout.status] ?? payout.status}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>

          <form className="card stack" onSubmit={saveDetails}>
            <h2>Реквізити для виплати</h2>
            <p className="muted">Повні реквізити зберігаються в зашифрованому вигляді. Після фактичної виплати зафіксовані для неї реквізити вже не змінюються.</p>
            <div className="grid cols-2">
              <div className="field"><label>Тип</label><input className="input" value={destinationType} onChange={(event) => setDestinationType(event.target.value)} /></div>
              <div className="field"><label>Маскований вигляд</label><input className="input" value={maskedDisplay} onChange={(event) => setMaskedDisplay(event.target.value)} placeholder="•••• 4821" required /></div>
            </div>
            <div className="field"><label>Повні реквізити</label><textarea className="input" rows={4} value={destinationDetails} onChange={(event) => setDestinationDetails(event.target.value)} required /></div>
            {details?.createdAt && <div className="muted">Поточні реквізити вже збережені.</div>}
            <button className="btn secondary">Зберегти реквізити</button>
          </form>

          <form className="card stack" onSubmit={loadStatement}>
            <h2>Виписка по рахунках</h2>
            <div className="grid cols-2">
              <div className="field"><label>Від</label><input className="input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div>
              <div className="field"><label>До</label><input className="input" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></div>
            </div>
            <button className="btn secondary">Сформувати виписку</button>
          </form>

          {statement && (
            <section className="card">
              <h2>Виписка</h2>
              <div className="metric">{money(statement.totalMinor)}</div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Дата</th><th>Учень</th><th>Предмет</th><th>Тип</th><th>Сума</th></tr></thead>
                  <tbody>{statement.items.map((item: any) => (
                    <tr key={item.id}>
                      <td>{dateOnly(item.earned_for_date)}</td>
                      <td>{item.student_last_name ? `${item.student_last_name} ${item.student_first_name}` : "—"}</td>
                      <td>{item.subject_name || "—"}</td>
                      <td>{typeLabel[item.type] ?? item.type}</td>
                      <td>{money(item.amount_minor)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}
    </PlatformShell>
  );
}
