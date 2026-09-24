"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { dateTime, lessonCount, phoneNumber } from "../lib/format";
import { PlatformShell } from "./platform-shell";

type StudentDashboardData = {
  student: {
    id: string;
    firstName?: string;
    lastName?: string;
    first_name?: string;
    last_name?: string;
    gradeLevel?: number | null;
    grade_level?: number | null;
  };
  enrollments: Array<{
    id: string;
    status: "ACTIVE" | "PAUSED" | "INACTIVE" | string;
    balanceLessonUnits: number;
    nextLessonAt?: string | null;
    subject: { id: string; name: string };
    primaryTeacher: null | {
      id: string;
      firstName: string;
      lastName: string;
      phone?: string | null;
      zoomUrl?: string | null;
      telegramUsername?: string | null;
    };
  }>;
  nextLessons: Array<{
    id: string;
    startsAt?: string;
    starts_at?: string;
    subjectId?: string;
    subject_id?: string;
    subjectName?: string;
    subject_name?: string;
    teacherFirstName?: string;
    teacher_first_name?: string;
    teacherLastName?: string;
    teacher_last_name?: string;
    teacherPhone?: string | null;
    teacher_phone?: string | null;
    teacherTelegramUsername?: string | null;
    teacher_telegram_username?: string | null;
    zoomUrl?: string | null;
    zoom_url?: string | null;
  }>;
};

type JournalEntry = {
  id: string;
  lessonNumber: number;
  startsAt: string;
  topicTitle?: string | null;
  homeworkAssigned?: boolean | null;
  actualTeacherFullName?: string | null;
  isSubstitute?: boolean;
};

type ProgressReport = {
  id: string;
  subjectId: string;
  subjectName?: string;
  reportType: "INITIAL" | "REQUESTED" | string;
  strengths: string;
  gaps: string;
  actionPlan: string;
  teacherFirstName?: string;
  teacherLastName?: string;
  createdAt: string;
};

function enrollmentStatus(status: string) {
  if (status === "ACTIVE") return { label: "Активне", className: "success-badge" };
  if (status === "PAUSED") return { label: "Пауза", className: "booked" };
  return { label: "Неактивне", className: "" };
}

function reportTypeLabel(type: string) {
  return type === "INITIAL" ? "Після першого уроку" : "Звіт про прогрес";
}

export function StudentLearningPage() {
  const [dashboard, setDashboard] = useState<StudentDashboardData | null>(null);
  const [journals, setJournals] = useState<Record<string, JournalEntry[]>>({});
  const [reports, setReports] = useState<ProgressReport[]>([]);
  const [expandedJournal, setExpandedJournal] = useState<Record<string, boolean>>({});
  const [activeSubjectId, setActiveSubjectId] = useState<string>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await api<StudentDashboardData>("/student/dashboard");
        const journalEntries = await Promise.all(
          data.enrollments.map(async enrollment => [
            enrollment.id,
            await api<JournalEntry[]>(`/enrollments/${enrollment.id}/journal`).catch(() => []),
          ] as const),
        );
        const reportRows = await api<ProgressReport[]>(`/students/${data.student.id}/reports`).catch(() => []);
        if (!active) return;
        setDashboard(data);
        setJournals(Object.fromEntries(journalEntries));
        setReports(reportRows);
      } catch (cause: any) {
        if (active) setError(cause.message ?? "Не вдалося завантажити навчання");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const visibleEnrollments = useMemo(() => {
    const rows = dashboard?.enrollments ?? [];
    return activeSubjectId === "ALL" ? rows : rows.filter(row => row.subject.id === activeSubjectId);
  }, [dashboard, activeSubjectId]);

  function nextLessonFor(subjectId: string) {
    return (dashboard?.nextLessons ?? []).find(lesson => (lesson.subjectId ?? lesson.subject_id) === subjectId) ?? null;
  }

  if (loading) {
    return <PlatformShell allowedRoles={["STUDENT"]}><div className="card muted">Завантажуємо навчання…</div></PlatformShell>;
  }

  return <PlatformShell allowedRoles={["STUDENT"]}>
    <div className="page-head student-learning-head">
      <div>
        <h1>Журнал і прогрес</h1>
        <p className="muted">Предмети, залишок занять, найближчі уроки, журнал і доступні тобі звіти.</p>
      </div>
      <div className="student-learning-nav row">
        <Link className="btn secondary" href="/student/schedule">Розклад</Link>
        <Link className="btn" href="/student/journal">Журнал</Link>
        <Link className="btn secondary" href="/student/courses">Курси</Link>
      </div>
    </div>

    {error && <div className="error">{error}</div>}

    {dashboard && <div className="stack student-learning-page">
      <div className="student-learning-summary card">
        <div>
          <div className="muted">Учень</div>
          <strong>{dashboard.student.lastName ?? dashboard.student.last_name} {dashboard.student.firstName ?? dashboard.student.first_name}</strong>
        </div>
        <div>
          <div className="muted">Предметів</div>
          <strong>{dashboard.enrollments.length}</strong>
        </div>
        <div>
          <div className="muted">Доступних звітів</div>
          <strong>{reports.length}</strong>
        </div>
        <div>
          <div className="muted">Найближчих уроків</div>
          <strong>{dashboard.nextLessons.length}</strong>
        </div>
      </div>

      {dashboard.enrollments.length > 1 && <div className="student-subject-filter segmented" aria-label="Фільтр предметів">
        <button className={activeSubjectId === "ALL" ? "active" : ""} onClick={() => setActiveSubjectId("ALL")}>Усі</button>
        {dashboard.enrollments.map(enrollment => <button key={enrollment.id} className={activeSubjectId === enrollment.subject.id ? "active" : ""} onClick={() => setActiveSubjectId(enrollment.subject.id)}>{enrollment.subject.name}</button>)}
      </div>}

      {visibleEnrollments.map(enrollment => {
        const status = enrollmentStatus(enrollment.status);
        const journal = [...(journals[enrollment.id] ?? [])].reverse();
        const showAll = expandedJournal[enrollment.id] === true;
        const visibleJournal = showAll ? journal : journal.slice(0, 5);
        const subjectReports = reports.filter(report => report.subjectId === enrollment.subject.id);
        const nextLesson = nextLessonFor(enrollment.subject.id);
        const teacher = enrollment.primaryTeacher;

        return <section className="card student-subject-card" key={enrollment.id}>
          <div className="student-subject-header">
            <div>
              <div className="row">
                <h2>{enrollment.subject.name}</h2>
                <span className={`badge ${status.className}`}>{status.label}</span>
              </div>
              {teacher ? <div className="student-teacher-line">
                <strong>{teacher.lastName} {teacher.firstName}</strong>
                <span className="muted">Основний викладач</span>
              </div> : <div className="muted">Викладача не призначено</div>}
            </div>
            <div className="student-balance-box">
              <span className="muted">Залишилось</span>
              <strong>{lessonCount(enrollment.balanceLessonUnits)}</strong>
            </div>
          </div>

          <div className="student-subject-context grid cols-2">
            <div className="student-info-panel">
              <div className="muted">Найближче заняття</div>
              {nextLesson ? <>
                <strong>{dateTime(nextLesson.startsAt ?? nextLesson.starts_at!)}</strong>
                <div className="muted">{nextLesson.teacherLastName ?? nextLesson.teacher_last_name} {nextLesson.teacherFirstName ?? nextLesson.teacher_first_name}</div>
                <div className="row student-contact-actions">
                  {(nextLesson.zoomUrl ?? nextLesson.zoom_url) && <a className="btn" target="_blank" rel="noreferrer" href={nextLesson.zoomUrl ?? nextLesson.zoom_url ?? undefined}>Приєднатися до Zoom</a>}
                  {(nextLesson.teacherPhone ?? nextLesson.teacher_phone) && <a className="btn secondary" href={`tel:${nextLesson.teacherPhone ?? nextLesson.teacher_phone}`}>Телефон</a>}
                  {(nextLesson.teacherTelegramUsername ?? nextLesson.teacher_telegram_username) && <a className="btn secondary" target="_blank" rel="noreferrer" href={`https://t.me/${String(nextLesson.teacherTelegramUsername ?? nextLesson.teacher_telegram_username).replace(/^@/, "")}`}>Telegram</a>}
                </div>
              </> : <span className="muted">Майбутніх занять поки немає.</span>}
            </div>

            <div className="student-info-panel">
              <div className="muted">Контакт викладача</div>
              {teacher ? <>
                <strong>{teacher.lastName} {teacher.firstName}</strong>
                <div className="row student-contact-actions">
                  {teacher.phone && <a className="btn secondary" href={`tel:${teacher.phone}`}>{phoneNumber(teacher.phone)}</a>}
                  {teacher.telegramUsername && <a className="btn secondary" target="_blank" rel="noreferrer" href={`https://t.me/${teacher.telegramUsername.replace(/^@/, "")}`}>@{teacher.telegramUsername.replace(/^@/, "")}</a>}
                </div>
              </> : <span className="muted">Контакт зʼявиться після призначення викладача.</span>}
            </div>
          </div>

          <div className="student-journal-section">
            <div className="section-heading row">
              <div>
                <h3>Журнал</h3>
                <p className="muted">Теми проведених уроків і факт домашнього завдання.</p>
              </div>
              {journal.length > 5 && <button className="btn secondary" onClick={() => setExpandedJournal(state => ({ ...state, [enrollment.id]: !state[enrollment.id] }))}>{showAll ? "Згорнути" : `Усі заняття · ${journal.length}`}</button>}
            </div>
            {visibleJournal.length ? <div className="table-wrap">
              <table className="journal-table student-journal-table">
                <thead><tr><th>№</th><th>Дата</th><th>Тема</th><th>ДЗ</th><th>Заміна</th></tr></thead>
                <tbody>{visibleJournal.map(entry => <tr key={entry.id}>
                  <td>{entry.lessonNumber}</td>
                  <td>{dateTime(entry.startsAt)}</td>
                  <td>{entry.topicTitle || "—"}</td>
                  <td>{entry.homeworkAssigned ? "Задано" : "Не задано"}</td>
                  <td>{entry.isSubstitute ? <span className="substitute-label">Провів: {entry.actualTeacherFullName}</span> : <span className="muted">—</span>}</td>
                </tr>)}</tbody>
              </table>
            </div> : <div className="empty compact-empty">Проведених занять ще немає.</div>}
          </div>

          <div className="student-reports-section">
            <div className="section-heading">
              <h3>Звіти</h3>
              <p className="muted">Тут відображаються лише звіти, які батьки дозволили показувати тобі.</p>
            </div>
            {subjectReports.length ? <div className="report-history-grid">
              {subjectReports.map(report => <article className="report-history-card student-report-card" key={report.id}>
                <div className="row report-card-head">
                  <span className="badge report">{reportTypeLabel(report.reportType)}</span>
                  <span className="muted">{dateTime(report.createdAt)}</span>
                </div>
                <p><strong>Добре виходить:</strong> {report.strengths}</p>
                <p><strong>Варто повторити:</strong> {report.gaps}</p>
                <p><strong>Подальший план:</strong> {report.actionPlan}</p>
                {(report.teacherFirstName || report.teacherLastName) && <div className="muted">Підготував: {report.teacherLastName} {report.teacherFirstName}</div>}
              </article>)}
            </div> : <div className="empty compact-empty">Доступних звітів з цього предмета поки немає.</div>}
          </div>
        </section>;
      })}

      {!visibleEnrollments.length && <div className="empty card">Навчальних предметів поки немає.</div>}
    </div>}
  </PlatformShell>;
}
