"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { dateOnly, kyivDateValue, money, timeOnly } from "../lib/format";
import { PlatformShell } from "./platform-shell";

type TeacherProfile = {
  firstName: string;
  lastName: string;
  teacherStatus: string;
  subjects: Array<{ id: string; name: string; isActive: boolean }>;
  summary?: { activeStudents: number };
};
type CalendarEvent = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  sessionType: "FIRST" | "REGULAR";
  student: { fullName: string };
  subject: { name: string };
  needsReport?: boolean;
};
type PayrollOverview = { currentPeriod: { period_start: string; period_end: string } | null };
type Statement = { totalMinor: number };

function fullDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return day + "." + month + "." + year;
}

const statusLabels: Record<string, string> = {
  ACTIVE: "Активний профіль",
  INVITED: "Запрошений",
  ON_LEAVE: "У відпустці",
  ARCHIVED: "Архівний профіль",
};

export function TeacherDashboard() {
  const [today] = useState(() => kyivDateValue());
  const [profile, setProfile] = useState<TeacherProfile | null>(null);
  const [sessions, setSessions] = useState<CalendarEvent[]>([]);
  const [payroll, setPayroll] = useState<PayrollOverview | null>(null);
  const [incomeView, setIncomeView] = useState<"PERIOD" | "MONTH">("PERIOD");
  const [statement, setStatement] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(true);
  const [incomeLoading, setIncomeLoading] = useState(true);
  const [error, setError] = useState("");
  const [incomeError, setIncomeError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([
      api<TeacherProfile>("/teachers/me/profile"),
      api<CalendarEvent[]>("/calendar?from=" + today + "&to=" + today),
      api<PayrollOverview>("/payroll/me"),
    ]).then(([nextProfile, nextSessions, nextPayroll]) => {
      if (!active) return;
      setProfile(nextProfile);
      setSessions(nextSessions);
      setPayroll(nextPayroll);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Не вдалося завантажити головну сторінку");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [today]);

  useEffect(() => {
    if (!payroll) return;
    const from = incomeView === "MONTH" ? today.slice(0, 7) + "-01" : payroll.currentPeriod?.period_start;
    const to = incomeView === "MONTH" ? today : payroll.currentPeriod?.period_end;
    if (!from || !to) {
      setStatement(null);
      setIncomeLoading(false);
      setIncomeError("Період виплати ще не визначено");
      return;
    }
    let active = true;
    setIncomeLoading(true);
    setIncomeError("");
    setStatement(null);
    api<Statement>("/payroll/me/statement?from=" + from + "&to=" + to)
      .then((value) => { if (active) setStatement(value); })
      .catch((cause: unknown) => {
        if (active) setIncomeError(cause instanceof Error ? cause.message : "Не вдалося завантажити нарахування");
      })
      .finally(() => { if (active) setIncomeLoading(false); });
    return () => { active = false; };
  }, [payroll, incomeView, today]);

  async function copyReferralLink() {
    try {
      await navigator.clipboard.writeText(new URL("/teachers/apply", window.location.origin).toString());
      setCopyMessage("Посилання на анкету скопійовано.");
    } catch {
      setCopyMessage("Не вдалося скопіювати посилання. Відкрийте анкету й скопіюйте адресу сторінки.");
    }
  }

  const periodLabel = incomeView === "MONTH"
    ? fullDate(today.slice(0, 7) + "-01") + " — " + fullDate(today)
    : payroll?.currentPeriod
      ? fullDate(payroll.currentPeriod.period_start) + " — " + fullDate(payroll.currentPeriod.period_end)
      : "—";

  return <PlatformShell allowedRoles={["TEACHER"]}>
    <div className="page-head">
      <div>
        <h1>Головна викладача</h1>
        <p className="muted">Сьогоднішні заняття, нарахування та корисні дії в одному місці.</p>
      </div>
      <Link className="btn secondary" href="/teacher/schedule">Увесь календар</Link>
    </div>

    {loading ? <div className="card muted">Завантажуємо дані викладача…</div> :
      error ? <div className="error" role="alert">{error}</div> :
      <div className="teacher-dashboard-layout">
        <div className="stack">
          <section className="card teacher-referral" aria-labelledby="teacher-referral-title">
            <div>
              <h2 id="teacher-referral-title">Рекомендуйте викладачів до нашої платформи</h2>
              <p>Знаєте сильного викладача? Поділіться анкетою для кандидатів.</p>
            </div>
            <div className="row">
              <button type="button" className="btn" onClick={() => void copyReferralLink()}>Скопіювати посилання</button>
              <Link className="btn secondary" href="/teachers/apply">Відкрити анкету</Link>
            </div>
            {copyMessage && <div className="muted" role="status">{copyMessage}</div>}
          </section>

          <section className="card teacher-income" aria-labelledby="teacher-income-title">
            <div className="teacher-dashboard-heading">
              <div>
                <h2 id="teacher-income-title">Мої нарахування</h2>
                <p className="muted">За проведені уроки та коригування у вибраному проміжку.</p>
              </div>
              <div className="segmented" role="group" aria-label="Період нарахувань">
                <button type="button" aria-pressed={incomeView === "PERIOD"} className={incomeView === "PERIOD" ? "active" : ""} onClick={() => setIncomeView("PERIOD")}>Період виплати</button>
                <button type="button" aria-pressed={incomeView === "MONTH"} className={incomeView === "MONTH" ? "active" : ""} onClick={() => setIncomeView("MONTH")}>Місяць</button>
              </div>
            </div>
            <div className="teacher-income-amount" aria-live="polite">{incomeLoading ? "Завантажуємо…" : incomeError ? "—" : money(statement?.totalMinor)}</div>
            <div className="muted">{periodLabel}</div>
            {incomeError && <div className="error" role="alert">{incomeError}</div>}
            <Link className="link-button" href="/teacher/payouts">Деталі виплат і виписка</Link>
          </section>

          <section className="card teacher-today" aria-labelledby="teacher-today-title">
            <div className="teacher-dashboard-heading">
              <div>
                <h2 id="teacher-today-title">Мій календар сьогодні</h2>
                <p className="muted">{dateOnly(today)} · {sessions.length} занять у розкладі</p>
              </div>
              <Link className="btn secondary" href="/teacher/schedule">Відкрити календар</Link>
            </div>
            {sessions.length ? <div className="teacher-today-list">
              {sessions.map((session) => <Link className="teacher-today-item" key={session.id}
                href={"/teacher/schedule?sessionId=" + session.id + "&date=" + today}>
                <strong>{timeOnly(session.startsAt)}–{timeOnly(session.endsAt)}</strong>
                <span>{session.student.fullName}<small className="muted">{session.subject.name} · {session.sessionType === "FIRST" ? "Перший урок" : "Регулярний урок"}</small></span>
                <span className={"badge " + (session.status === "COMPLETED" ? "success-badge" : "booked")}>{session.status === "COMPLETED" ? "Проведено" : "За розкладом"}</span>
                {session.needsReport && <span className="badge report">Потрібен звіт</span>}
              </Link>)}
            </div> : <div className="empty compact-empty">На сьогодні занять немає.</div>}
          </section>
        </div>

        <aside className="stack teacher-dashboard-side">
          <section className="card" aria-labelledby="teacher-profile-title">
            <h2 id="teacher-profile-title">Мій профіль</h2>
            {profile && <>
              <strong className="teacher-dashboard-name">{profile.lastName} {profile.firstName}</strong>
              <span className="badge">{statusLabels[profile.teacherStatus] ?? profile.teacherStatus}</span>
              <div className="muted">{profile.subjects.filter((subject) => subject.isActive).map((subject) => subject.name).join(", ") || "Предмети не вказано"}</div>
              <div className="muted">Активних учнів: {profile.summary?.activeStudents ?? 0}</div>
            </>}
            <Link className="btn secondary" href="/profile">Перейти до профілю</Link>
          </section>
          <section className="card">
            <h2>Швидкі переходи</h2>
            <div className="teacher-dashboard-links">
              <Link href="/teacher/students">Мої учні</Link>
              <Link href="/teacher/availability">Вільні години</Link>
              <Link href="/teacher/payouts">Виплати</Link>
              <Link href="/teacher/knowledge">База знань</Link>
            </div>
          </section>
          <section className="card teacher-knowledge-preview">
            <h2>База знань</h2>
            <p className="muted">Від першого уроку до виплат — короткі інструкції з переходами до дій.</p>
            <Link href="/teacher/knowledge#first-lesson">Як провести перший урок →</Link>
            <Link href="/teacher/knowledge#payouts">Як читати нарахування →</Link>
          </section>
        </aside>
      </div>}
  </PlatformShell>;
}
