"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, type Me } from "../lib/api";
import { PlatformShell } from "./platform-shell";
import { TeacherAvailabilityEditor } from "./teacher-availability-editor";

export function TeacherAvailabilityPage({ showVacations = false }: { showVacations?: boolean }) {
  const [me, setMe] = useState<Me | null>(null);
  const [data, setData] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [vacationFormOpen, setVacationFormOpen] = useState(false);
  const [vacationBusy, setVacationBusy] = useState(false);
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [vacationComment, setVacationComment] = useState("");

  async function load(user?: Me) {
    try {
      const current = user ?? (await api<{ user: Me }>("/auth/me")).user;
      setMe(current);
      if (showVacations) setData(await api<any>(`/teachers/${current.id}/availability`));
    } catch (exception: any) {
      setError(exception?.message ?? "Не вдалося завантажити дані");
    }
  }

  useEffect(() => { void load(); }, [showVacations]);

  async function requestVacation(event: FormEvent) {
    event.preventDefault();
    if (!me || !startsOn || !endsOn) return;
    setVacationBusy(true); setError(""); setMessage("");
    try {
      await api(`/teachers/${me.id}/vacations`, {
        method: "POST",
        body: JSON.stringify({ startsOn, endsOn, comment: vacationComment.trim() || undefined }),
      });
      setMessage("Запит на відпустку надіслано менеджеру");
      setVacationFormOpen(false); setStartsOn(""); setEndsOn(""); setVacationComment("");
      await load(me);
    } catch (exception: any) {
      setError(exception?.message ?? "Не вдалося створити запит на відпустку");
    } finally {
      setVacationBusy(false);
    }
  }

  return <PlatformShell allowedRoles={["TEACHER"]}>
    <div className="page-head">
      <div>
        <h1>{showVacations ? "Відпустки" : "Вільні години"}</h1>
        <p className="muted">{showVacations ? "Запити погоджує менеджер. До погодження календар не очищається." : "Налаштуйте сезонний тиждень, копіюйте дні й додавайте разові винятки."}</p>
      </div>
      {showVacations && <button className="btn" onClick={() => setVacationFormOpen((value) => !value)}>{vacationFormOpen ? "Закрити форму" : "+ Запит на відпустку"}</button>}
    </div>

    {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
    {message && <div className="success" style={{ marginBottom: 12 }}>{message}</div>}

    {!showVacations && me && <TeacherAvailabilityEditor teacherId={me.id} />}

    {showVacations && <div className="stack">
      {vacationFormOpen && <form className="card stack" onSubmit={requestVacation}>
        <h2>Новий запит</h2>
        <div className="grid cols-2">
          <div className="field"><label>Початок *</label><input className="input" type="date" required value={startsOn} onChange={(event) => { setStartsOn(event.target.value); if (!endsOn) setEndsOn(event.target.value); }} /></div>
          <div className="field"><label>Останній день *</label><input className="input" type="date" required min={startsOn || undefined} value={endsOn} onChange={(event) => setEndsOn(event.target.value)} /></div>
        </div>
        <div className="field"><label>Коментар</label><textarea className="textarea" rows={3} maxLength={1000} value={vacationComment} onChange={(event) => setVacationComment(event.target.value)} placeholder="Необовʼязково" /></div>
        <p className="muted form-note">Після погодження менеджер побачить усі заняття, яких торкається відпустка, і для кожного призначить заміну або перенесення.</p>
        <button className="btn" disabled={vacationBusy}>{vacationBusy ? "Надсилаємо…" : "Надіслати запит"}</button>
      </form>}

      {(data?.vacations ?? []).map((vacation: any) => <div className="card" key={vacation.id}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>{vacation.startsOn ?? vacation.starts_on} — {vacation.endsOn ?? vacation.ends_on}</strong>
          <span className={`badge ${vacation.status === "APPROVED" ? "paid" : vacation.status === "REJECTED" ? "" : "booked"}`}>{vacation.status}</span>
        </div>
        {vacation.comment && <p className="muted" style={{ marginTop: 8 }}>{vacation.comment}</p>}
      </div>)}
      {!data?.vacations?.length && <div className="card muted">Запитів на відпустку немає.</div>}
    </div>}
  </PlatformShell>;
}
