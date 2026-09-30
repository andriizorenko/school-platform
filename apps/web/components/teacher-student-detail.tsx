"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { dateTime, phoneNumber } from "../lib/format";
import { ErrorCard, LoadingCard } from "./loadable";
import { PlatformShell } from "./platform-shell";

const dayLabels: Record<number, string> = { 1: "Пн", 2: "Вт", 3: "Ср", 4: "Чт", 5: "Пт", 6: "Сб", 7: "Нд" };

function scheduleText(slots: any[]) {
  if (!slots?.length) return "Графік не задано";
  return slots.map((slot) => `${dayLabels[Number(slot.dayOfWeek)] ?? "—"} ${String(slot.startTime).slice(0, 5)}`).join(" · ");
}

function teacherName(row: any) {
  if (row.actualTeacherFullName) return row.actualTeacherFullName;
  if (row.actualTeacher) return `${row.actualTeacher.lastName ?? ""} ${row.actualTeacher.firstName ?? ""}`.trim();
  return "—";
}

export function TeacherStudentDetail({ studentId }: { studentId: string }) {
  const [student, setStudent] = useState<any>(null);
  const [journals, setJournals] = useState<Record<string, any[]>>({});
  const [reports, setReports] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { strengths: string; gaps: string; actionPlan: string }>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [message, setMessage] = useState("");
  const [reportError, setReportError] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [detail, reportRows] = await Promise.all([
        api<any>(`/teachers/me/students/${studentId}`),
        api<any[]>(`/students/${studentId}/reports`).catch(() => []),
      ]);
      const journalEntries = await Promise.all((detail.enrollments ?? []).map(async (enrollment: any) => [
        enrollment.id,
        await api<any[]>(`/enrollments/${enrollment.id}/journal`).catch(() => []),
      ] as const));
      setStudent(detail);
      setReports(reportRows);
      setJournals(Object.fromEntries(journalEntries));
      setDrafts((current) => {
        const next = { ...current };
        for (const request of detail.pendingReports ?? []) {
          next[request.id] ??= { strengths: "", gaps: "", actionPlan: "" };
        }
        return next;
      });
    } catch (reason) {
      setError(reason as Error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [studentId]);

  const pendingBySubject = useMemo(() => {
    const result = new Map<string, any[]>();
    for (const request of student?.pendingReports ?? []) {
      const items = result.get(request.subjectId) ?? [];
      items.push(request);
      result.set(request.subjectId, items);
    }
    return result;
  }, [student]);

  async function completeReport(requestId: string) {
    const draft = drafts[requestId];
    if (!draft?.strengths.trim() || !draft.gaps.trim() || !draft.actionPlan.trim()) {
      setMessage("");
      setReportError("Заповни всі три частини звіту.");
      return;
    }
    setSaving(requestId);
    setMessage("");
    setReportError("");
    try {
      await api(`/report-requests/${requestId}/complete`, {
        method: "POST",
        body: JSON.stringify({
          strengths: draft.strengths.trim(),
          gaps: draft.gaps.trim(),
          actionPlan: draft.actionPlan.trim(),
        }),
      });
      setMessage("Звіт збережено та надіслано батькам.");
      await load();
    } catch (reason) {
      setReportError(reason instanceof Error ? reason.message : "Не вдалося зберегти звіт");
    } finally {
      setSaving(null);
    }
  }

  return <PlatformShell allowedRoles={["TEACHER"]}>
    {loading ? <LoadingCard /> : error ? <ErrorCard error={error} /> : student && <div className="stack teacher-student-detail">
      <div className="page-head">
        <div>
          <h1 className="teacher-student-detail-name">{student.lastName} {student.firstName}</h1>
          <p className="muted">{student.gradeLevel ? `${student.gradeLevel} клас` : "Клас не вказано"}</p>
        </div>
        {(student.pendingReports?.length ?? 0) > 0 && <span className="report-alert">ТРЕБА ЗВІТ · {student.pendingReports.length}</span>}
      </div>

      {reportError && <div className="error" role="alert">{reportError}</div>}
      {message && <div className="success" role="status">{message}</div>}

      <div className="grid cols-2">
        <div className="card teacher-parent-contact-card">
          <h2>Контакт батьків</h2>
          <strong>{student.parent.lastName} {student.parent.firstName}</strong>
          <div className="teacher-contact-actions">
            <a className="btn secondary" href={`tel:${student.parent.phone}`}>{phoneNumber(student.parent.phone)}</a>
            {student.parent.telegramUsername && <a className="btn secondary" href={`https://t.me/${String(student.parent.telegramUsername).replace(/^@/, "")}`} target="_blank" rel="noreferrer">Telegram</a>}
          </div>
          <div className="muted">{student.parent.email}</div>
        </div>
        <div className="card">
          <h2>Навчання зі мною</h2>
          <strong>{student.enrollments.filter((item: any) => item.activeForTeacher).length}</strong>
          <div className="muted">активних предметів</div>
        </div>
      </div>

      {(student.enrollments ?? []).map((enrollment: any) => {
        const pending = pendingBySubject.get(enrollment.subject.id) ?? [];
        const journal = [...(journals[enrollment.id] ?? [])].reverse();
        return <section className="card teacher-enrollment-card" key={enrollment.id}>
          <div className="page-head compact-page-head">
            <div>
              <div className="row"><h2 className="teacher-enrollment-title">{enrollment.subject.name}</h2>{!enrollment.activeForTeacher && <span className="badge">Архів</span>}{enrollment.status === "PAUSED" && <span className="badge">Пауза</span>}</div>
              <div className="muted">{scheduleText(enrollment.schedule)}</div>
            </div>
            {pending.length > 0 && <span className="report-alert">ТРЕБА ЗВІТ</span>}
          </div>

          <div className="grid cols-3 teacher-enrollment-summary">
            <div><div className="muted">Залишилось</div><strong>{enrollment.balance.lessonUnits} заняття</strong></div>
            <div><div className="muted">Тривалість</div><strong>{enrollment.defaultDurationMinutes} хв</strong></div>
            <div><div className="muted">Найближче заняття</div><strong>{enrollment.nextSession ? dateTime(enrollment.nextSession.startsAt) : "—"}</strong></div>
          </div>

          {pending.map((request: any) => <div
            className="report-request-card"
            id={request.id === student.pendingReports?.[0]?.id ? "pending-reports" : undefined}
            key={request.id}
          >
            <div className="row report-request-heading">
              <div>
                <strong>Звіт за запитом батьків</strong>
                <div className="muted">{request.targetStartsAt ? `Цільове заняття: ${dateTime(request.targetStartsAt)}` : "Запит очікує призначення заняття"}</div>
                {request.targetSessionStatus !== "COMPLETED" && <div className="muted">Звіт можна завершити після проведення цього заняття.</div>}
              </div>
              <span className="badge">{request.visibleToStudent ? "Бачить учень" : "Лише батьки"}</span>
            </div>
            <div className="grid cols-3 report-form-grid">
              <label className="field"><span>Що добре знає</span><textarea className="textarea" value={drafts[request.id]?.strengths ?? ""} onChange={(event) => setDrafts((state) => ({ ...state, [request.id]: { ...(state[request.id] ?? { strengths: "", gaps: "", actionPlan: "" }), strengths: event.target.value } }))} /></label>
              <label className="field"><span>Що треба повторити</span><textarea className="textarea" value={drafts[request.id]?.gaps ?? ""} onChange={(event) => setDrafts((state) => ({ ...state, [request.id]: { ...(state[request.id] ?? { strengths: "", gaps: "", actionPlan: "" }), gaps: event.target.value } }))} /></label>
              <label className="field"><span>Подальший план</span><textarea className="textarea" value={drafts[request.id]?.actionPlan ?? ""} onChange={(event) => setDrafts((state) => ({ ...state, [request.id]: { ...(state[request.id] ?? { strengths: "", gaps: "", actionPlan: "" }), actionPlan: event.target.value } }))} /></label>
            </div>
            <button className="btn" disabled={Boolean(saving) || request.targetSessionStatus !== "COMPLETED"} onClick={() => void completeReport(request.id)}>{saving === request.id ? "Зберігаю…" : request.targetSessionStatus === "COMPLETED" ? "Завершити звіт" : "Очікуємо заняття"}</button>
          </div>)}

          <div id="journal" className="teacher-journal-section">
            <div className="section-heading row">
              <div><h3>Журнал</h3><p className="muted">Спільна історія предмета, включно із заняттями на заміні.</p></div>
            </div>
            {journal.length ? <div className="table-wrap"><table className="journal-table">
              <thead><tr><th>№</th><th>Дата</th><th>Тема</th><th>ДЗ</th><th>Провів</th></tr></thead>
              <tbody>{journal.map((entry: any) => <tr key={entry.id}>
                <td>{entry.lessonNumber}</td>
                <td>{dateTime(entry.startsAt)}</td>
                <td>{entry.topicTitle || "—"}</td>
                <td>{entry.homeworkAssigned ? <>Задано{entry.homeworkDescription && <span className="journal-homework-description">{entry.homeworkDescription}</span>}</> : "Не задано"}</td>
                <td>{entry.isSubstitute ? <span className="substitute-label">Провів: {teacherName(entry)}</span> : <span className="muted">—</span>}</td>
              </tr>)}</tbody>
            </table></div> : <div className="empty compact-empty">Проведених занять ще немає</div>}
          </div>
        </section>;
      })}

      <section className="card">
        <div className="section-heading"><h2>Звіти про успішність</h2><p className="muted">Попередні звіти по предметах, з якими ти працював.</p></div>
        {reports.length ? <div className="report-history-grid">{reports.map((report: any) => <article className="report-history-card" key={report.id}>
          <div className="row report-request-heading"><strong>{report.subjectName}</strong><span className="muted">{dateTime(report.createdAt)}</span></div>
          <p><strong>Сильні сторони:</strong> {report.strengths}</p>
          <p><strong>Прогалини:</strong> {report.gaps}</p>
          <p><strong>План:</strong> {report.actionPlan}</p>
        </article>)}</div> : <div className="empty compact-empty">Звітів ще немає</div>}
      </section>
    </div>}
  </PlatformShell>;
}
