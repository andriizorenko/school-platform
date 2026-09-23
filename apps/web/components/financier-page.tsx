"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { dateOnly, money } from "../lib/format";
import { PlatformShell } from "./platform-shell";

const payoutStatusLabel: Record<string, string> = {
  PENDING: "Немає реквізитів",
  READY: "Готово до виплати",
  PAID: "Виплачено",
};

const typeLabel: Record<string, string> = {
  REGULAR_60: "Регулярне 60 хв",
  REGULAR_30: "Регулярне 30 хв",
  FIRST_LESSON: "Перше заняття",
  PAID_STUDENT_NO_SHOW: "Оплачений no-show",
  COMPENSATION: "Компенсаційне",
  ADJUSTMENT: "Коригування",
};

const periodStatusLabel: Record<string, string> = {
  OPEN: "Нараховується",
  CALCULATED: "Розраховано",
  PAYING: "Виплачується",
  PAID: "Закрито",
};

export function FinancierPage() {
  const [periods, setPeriods] = useState<any[]>([]);
  const [selected, setSelected] = useState("");
  const [payouts, setPayouts] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedPeriod = useMemo(() => periods.find((period) => period.id === selected), [periods, selected]);
  const readyIds = payouts
    .filter((payout) => payout.status === "READY" && !payout.missing_details)
    .map((payout) => payout.id);

  async function loadPeriods(keepSelected = true) {
    const result = await api<any[]>("/payroll/periods");
    setPeriods(result);
    const nextSelected = keepSelected && selected ? selected : result[0]?.id ?? "";
    if (!selected && nextSelected) setSelected(nextSelected);
    return nextSelected;
  }

  async function loadPayouts(periodId = selected) {
    if (!periodId) return;
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (status) params.set("status", status);
    const result = await api<any[]>(`/payroll/periods/${periodId}/payouts?${params.toString()}`);
    setPayouts(result);
    setChecked((current) => current.filter((id) => result.some((payout) => payout.id === id && payout.status === "READY")));
  }

  async function initialLoad() {
    try {
      const periodId = await loadPeriods(false);
      if (periodId) await loadPayouts(periodId);
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    void initialLoad();
  }, []);

  useEffect(() => {
    if (!selected) return;
    const timeout = window.setTimeout(() => {
      void loadPayouts(selected).catch((e: any) => setError(e.message));
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [selected, query, status]);

  async function calculate() {
    if (!selected) return;
    try {
      setBusy(true);
      await api(`/payroll/periods/${selected}/calculate`, { method: "POST" });
      setMessage("Розрахунок оновлено. Виплачені рядки залишилися незмінними.");
      await Promise.all([loadPeriods(), loadPayouts()]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(id: string) {
    try {
      setBusy(true);
      await api(`/payroll/payouts/${id}/confirm`, { method: "POST" });
      setMessage("Виплату підтверджено й зафіксовано в історії.");
      await Promise.all([loadPeriods(), loadPayouts()]);
      if (detail?.payout?.id === id) setDetail(await api<any>(`/payroll/payouts/${id}`));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function bulkConfirm() {
    if (!checked.length) return;
    try {
      setBusy(true);
      const result = await api<any>("/payroll/payouts/bulk-confirm", {
        method: "POST",
        body: JSON.stringify({ payoutIds: checked }),
      });
      setChecked([]);
      setMessage(`Підтверджено виплат: ${result.confirmedCount}.`);
      await Promise.all([loadPeriods(), loadPayouts()]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function open(id: string) {
    try {
      setDetail(await api<any>(`/payroll/payouts/${id}`));
    } catch (e: any) {
      setError(e.message);
    }
  }

  function toggle(id: string) {
    setChecked((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function toggleAllReady() {
    setChecked((current) => readyIds.every((id) => current.includes(id)) ? [] : readyIds);
  }

  return (
    <PlatformShell allowedRoles={["FINANCIER", "ADMIN"]}>
      <div className="page-head">
        <div>
          <h1>Виплати викладачам</h1>
          <p className="muted">14 днів нарахування, потім 3 дні на виплату. Підтверджена виплата більше не перераховується.</p>
        </div>
        <div className="row">
          <select className="select" value={selected} onChange={(event) => setSelected(event.target.value)}>
            {periods.map((period) => (
              <option key={period.id} value={period.id}>
                {dateOnly(period.period_start)} — {dateOnly(period.period_end)} · {periodStatusLabel[period.status] ?? period.status}
              </option>
            ))}
          </select>
          <button className="btn" disabled={!selected || busy || selectedPeriod?.status === "PAID"} onClick={calculate}>
            {selectedPeriod?.calculated_at ? "Перерахувати зміни" : "Розрахувати"}
          </button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}

      {selectedPeriod && (
        <div className="grid cols-4" style={{ marginBottom: 16 }}>
          <div className="card"><div className="muted">До виплати</div><div className="metric">{money(selectedPeriod.total_minor)}</div></div>
          <div className="card"><div className="muted">Виплачено</div><div className="metric">{selectedPeriod.paid_count}/{selectedPeriod.payout_count}</div></div>
          <div className="card"><div className="muted">Без реквізитів</div><div className="metric">{selectedPeriod.missing_details_count}</div></div>
          <div className="card"><div className="muted">Коригування минулих періодів</div><div className="metric">{money(selectedPeriod.adjustment_minor)}</div></div>
        </div>
      )}

      {selectedPeriod?.pending_recalc_count > 0 && selectedPeriod.status !== "PAID" && (
        <div className="card" style={{ marginBottom: 16, borderColor: "#fdb022" }}>
          <strong>Є зміни після останнього розрахунку: {selectedPeriod.pending_recalc_count}</strong>
          <div className="muted" style={{ marginTop: 4 }}>Натисніть «Перерахувати зміни». Уже виплачені рядки не зміняться.</div>
        </div>
      )}

      {selectedPeriod && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
            <div className="row" style={{ flex: 1, alignItems: "flex-end" }}>
              <div className="field" style={{ flex: 1, maxWidth: 360 }}>
                <label>Пошук викладача</label>
                <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Прізвище або імʼя" />
              </div>
              <div className="field" style={{ minWidth: 220 }}>
                <label>Статус</label>
                <select className="select" value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="">Усі</option>
                  <option value="PENDING">Немає реквізитів</option>
                  <option value="READY">Готові до виплати</option>
                  <option value="PAID">Виплачені</option>
                </select>
              </div>
            </div>
            <button className="btn" disabled={!checked.length || busy} onClick={bulkConfirm}>Підтвердити вибрані ({checked.length})</button>
          </div>
          <div className="muted" style={{ marginTop: 10 }}>
            Вікно виплати: {dateOnly(selectedPeriod.payout_window_start)} — {dateOnly(selectedPeriod.payout_window_end)}
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" aria-label="Вибрати всі готові" checked={readyIds.length > 0 && readyIds.every((id) => checked.includes(id))} onChange={toggleAllReady} /></th>
              <th>Викладач</th>
              <th>Сума</th>
              <th>Куди</th>
              <th>Коригування</th>
              <th>Статус</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {payouts.map((payout) => (
              <tr key={payout.id}>
                <td><input type="checkbox" disabled={payout.status !== "READY" || payout.missing_details} checked={checked.includes(payout.id)} onChange={() => toggle(payout.id)} /></td>
                <td><button className="link-button" onClick={() => open(payout.id)}>{payout.last_name} {payout.first_name}</button></td>
                <td>{money(payout.amount_snapshot_minor)}</td>
                <td>{payout.payout_destination_masked || <span className="badge">Немає реквізитів</span>}</td>
                <td>{Number(payout.adjustment_minor) > 0 ? <span className="badge booked">+ {money(payout.adjustment_minor)}</span> : "—"}</td>
                <td><span className={`badge ${payout.status === "PAID" ? "paid" : "booked"}`}>{payoutStatusLabel[payout.status] ?? payout.status}</span></td>
                <td>{payout.status === "READY" && !payout.missing_details && <button className="btn" disabled={busy} onClick={() => confirm(payout.id)}>Підтвердити</button>}</td>
              </tr>
            ))}
            {!payouts.length && <tr><td colSpan={7} className="muted">Для цього фільтра виплат немає.</td></tr>}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="sheet-backdrop" onClick={() => setDetail(null)}>
          <aside className="sheet" onClick={(event) => event.stopPropagation()}>
            <button className="sheet-close" onClick={() => setDetail(null)}>×</button>
            <div className="stack" style={{ marginTop: 40 }}>
              <div>
                <h2>{detail.payout.last_name} {detail.payout.first_name}</h2>
                <div className="muted">{dateOnly(detail.payout.period_start)} — {dateOnly(detail.payout.period_end)}</div>
              </div>
              <div className="metric">{money(detail.payout.amount_snapshot_minor)}</div>
              <div className="muted">{detail.payout.fullDestination || detail.payout.payout_destination_masked || "Реквізити не заповнені"}</div>

              <div className="grid cols-2">
                {detail.breakdown.map((item: any) => (
                  <div className="card" key={item.code}>
                    <div className="muted">{item.label}</div>
                    <strong>{item.count} · {money(item.amountMinor)}</strong>
                  </div>
                ))}
              </div>

              <div className="table-wrap">
                <table>
                  <thead><tr><th>Дата</th><th>Тип</th><th>Учень</th><th>Предмет</th><th>Сума</th></tr></thead>
                  <tbody>
                    {detail.items.map((item: any) => (
                      <tr key={item.id}>
                        <td>{dateOnly(item.earned_for_date)}</td>
                        <td>{item.isAdjustment ? <span className="badge booked">Коригування</span> : (typeLabel[item.type] ?? item.type)}</td>
                        <td>{item.student_last_name ? `${item.student_last_name} ${item.student_first_name}` : "—"}</td>
                        <td>{item.subject_name || "—"}</td>
                        <td>{money(item.amount_minor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {detail.payout.status === "READY" && detail.payout.payout_destination_masked && (
                <button className="btn" disabled={busy} onClick={() => confirm(detail.payout.id)}>Підтвердити виплату</button>
              )}
            </div>
          </aside>
        </div>
      )}
    </PlatformShell>
  );
}
