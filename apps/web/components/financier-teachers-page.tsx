"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { money } from "../lib/format";
import { PlatformShell } from "./platform-shell";

export function FinancierTeachersPage() {
  const [query, setQuery] = useState("");
  const [teachers, setTeachers] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      api<any[]>(`/payroll/teachers?${params.toString()}`)
        .then((result) => { setTeachers(result); setError(""); })
        .catch((e: any) => setError(e.message));
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [query]);

  return (
    <PlatformShell allowedRoles={["FINANCIER", "ADMIN"]}>
      <div className="page-head">
        <div>
          <h1>Викладачі</h1>
          <p className="muted">Поточні ставки, реквізити та ще не закриті нарахування. Ставки тут лише для перегляду.</p>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="field" style={{ maxWidth: 420 }}>
          <label>Пошук</label>
          <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Прізвище або імʼя" />
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Викладач</th><th>Ставки</th><th>Нараховано</th><th>Куди</th><th>Остання виплата</th></tr></thead>
          <tbody>
            {teachers.map((teacher) => (
              <tr key={teacher.user_id}>
                <td><strong>{teacher.last_name} {teacher.first_name}</strong><div className="muted">{teacher.status}</div></td>
                <td>{(teacher.rates ?? []).length ? (teacher.rates ?? []).map((rate: any) => <div key={`${teacher.user_id}-${rate.subject}`}>{rate.subject}: {money(rate.rate60Minor)}/год</div>) : <span className="muted">Ставку не задано</span>}</td>
                <td>{money(teacher.unsettled_minor)}</td>
                <td>{teacher.masked_display || <span className="badge">Немає реквізитів</span>}</td>
                <td>{teacher.last_payout_minor !== null && teacher.last_payout_minor !== undefined ? <><div>{money(teacher.last_payout_minor)}</div><span className={`badge ${teacher.last_payout_status === "PAID" ? "paid" : "booked"}`}>{teacher.last_payout_status}</span></> : "—"}</td>
              </tr>
            ))}
            {!teachers.length && <tr><td colSpan={5} className="muted">Викладачів не знайдено.</td></tr>}
          </tbody>
        </table>
      </div>
    </PlatformShell>
  );
}
