"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { dateTime, money, timeOnly } from "../lib/format";
import { useData } from "../lib/use-data";
import { ErrorCard, LoadingCard } from "./loadable";
import { PlatformShell } from "./platform-shell";

type TodayEvent = {
  id: string;
  startsAt?: string;
  starts_at?: string;
  endsAt?: string;
  ends_at?: string;
  student?: { fullName?: string };
  studentFirstName?: string;
  student_first_name?: string;
  studentLastName?: string;
  student_last_name?: string;
  subject?: { name?: string };
  subjectName?: string;
  subject_name?: string;
  fundingStatus?: string;
  funding_status?: string;
  status?: string;
  sessionType?: string;
  session_type?: string;
};

function localDateParam() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function startsAt(event: TodayEvent) { return event.startsAt ?? event.starts_at ?? ""; }
function endsAt(event: TodayEvent) { return event.endsAt ?? event.ends_at ?? ""; }
function studentName(event: TodayEvent) {
  return event.student?.fullName ?? ([event.studentLastName ?? event.student_last_name, event.studentFirstName ?? event.student_first_name].filter(Boolean).join(" ") || "Учень");
}
function subjectName(event: TodayEvent) { return event.subject?.name ?? event.subjectName ?? event.subject_name ?? "Предмет"; }
function funding(event: TodayEvent) { return event.fundingStatus ?? event.funding_status ?? "BOOKED"; }
function sessionType(event: TodayEvent) { return event.sessionType ?? event.session_type ?? "REGULAR"; }

function KpiCard({ label, value, help, tone = "blue" }: { label: string; value: React.ReactNode; help: React.ReactNode; tone?: "blue"|"mint"|"amber"|"violet" }) {
  return <article className={`glass-kpi glass-kpi-${tone}`}>
    <div className="glass-kpi-top"><span className="glass-kpi-dot" /><span>{label}</span></div>
    <div className="glass-kpi-value">{value}</div>
    <div className="glass-kpi-help">{help}</div>
  </article>;
}

export function OpsDashboard({ role }: { role: "ADMIN"|"MANAGER" }) {
  const { data, error, loading } = useData<any>("/ops/dashboard");
  const [events, setEvents] = useState<TodayEvent[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const allowed = role === "ADMIN" ? ["ADMIN", "SUPPORT_MANAGER"] : ["MANAGER"];
  const base = role.toLowerCase();

  useEffect(() => {
    const today = localDateParam();
    Promise.all([
      api<any>(`/calendar?from=${today}&to=${today}`).catch(() => []),
      api<any[]>("/ops/payments?limit=5").catch(() => []),
    ]).then(([calendar, paymentRows]) => {
      const rows = Array.isArray(calendar) ? calendar : calendar?.events ?? calendar?.items ?? [];
      setEvents(rows.sort((a: TodayEvent, b: TodayEvent) => startsAt(a).localeCompare(startsAt(b))));
      setPayments(paymentRows);
    });
  }, []);

  const currentDate = useMemo(() => new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date()), []);

  return <PlatformShell allowedRoles={allowed}>
    <section className="glass-dashboard-head">
      <div>
        <div className="dashboard-eyebrow">Операційний центр школи</div>
        <h1>{role === "ADMIN" ? "Стан школи" : "Панель менеджера"}</h1>
        <p className="muted">Ключові показники, сьогоднішні заняття та задачі, які потребують уваги.</p>
      </div>
      <div className="dashboard-date"><span>Сьогодні</span><strong>{currentDate}</strong></div>
    </section>

    {loading ? <LoadingCard /> : error ? <ErrorCard error={error} /> : data && <div className="stack glass-dashboard-stack">
      <div className="glass-kpi-grid">
        <KpiCard label="Активні учні" value={data.metrics.active_students} help="навчаються зараз" tone="blue" />
        <KpiCard label="Занять сьогодні" value={data.metrics.lessons_today} help="у поточному календарі" tone="mint" />
        <KpiCard label="Викладачі" value={data.metrics.teachers} help="активна команда" tone="violet" />
        <KpiCard label="Нові заявки" value={data.attention.new_leads} help="очікують обробки" tone="amber" />
      </div>

      <div className="dashboard-main-grid">
        <section className="card glass-panel">
          <div className="panel-head">
            <div><span className="panel-kicker">Сьогодні</span><h2>Найближчі заняття</h2></div>
            <Link className="text-link" href={`/${base}/schedule`}>Весь розклад →</Link>
          </div>
          <div className="today-lessons">
            {events.slice(0, 6).map((event) => {
              const state = String(event.status ?? "").toUpperCase();
              const isCompleted = state === "COMPLETED";
              const isNoShow = state === "CHARGED_NO_SHOW";
              return <Link href={`/${base}/schedule`} className="today-lesson-row" key={event.id}>
                <div className="lesson-time-block"><strong>{timeOnly(startsAt(event))}</strong><small>{timeOnly(endsAt(event))}</small></div>
                <span className={`lesson-status-line ${isCompleted ? "done" : isNoShow ? "no-show" : ""}`} />
                <div className="today-lesson-copy">
                  <strong>{subjectName(event)}</strong>
                  <span>{studentName(event)}</span>
                </div>
                <div className="today-lesson-badges">
                  <span className={`badge ${sessionType(event) === "FIRST" ? "first" : ""}`}>{sessionType(event) === "FIRST" ? "Перше" : "Регулярне"}</span>
                  {isCompleted ? <span className="badge success-badge">Проведено</span> : isNoShow ? <span className="badge charged-no-show-badge">Списано</span> : <span className={`badge ${funding(event).toLowerCase()}`}>{funding(event) === "PAID" ? "Сплачено" : "Бронь"}</span>}
                </div>
              </Link>;
            })}
            {!events.length && <div className="empty compact-empty">На сьогодні занять не знайдено.</div>}
          </div>
        </section>

        <section className="card glass-panel">
          <div className="panel-head"><div><span className="panel-kicker">Контроль</span><h2>Потребує уваги</h2></div></div>
          <div className="attention-grid">
            <Link href={`/${base}/students?balance=LOW`} className="attention-card warning">
              <span>Низький баланс</span><strong>{data.attention.low_balance}</strong><small>≤ 3 занять</small>
            </Link>
            <Link href={`/${base}/students?balance=ZERO`} className="attention-card danger">
              <span>Баланс вичерпано</span><strong>{data.attention.zero_balance}</strong><small>потрібне поповнення</small>
            </Link>
            <Link href={`/${base}/schedule`} className="attention-card violet">
              <span>Броні без оплати</span><strong>{data.attention.booked_unpaid}</strong><small>майбутні уроки</small>
            </Link>
            <Link href={`/${base}/schedule`} className="attention-card blue">
              <span>Невідмічені уроки</span><strong>{data.attention.unmarked_lessons}</strong><small>після завершення</small>
            </Link>
            <Link href={`/${base}/vacations`} className="attention-card mint">
              <span>Відпустки</span><strong>{data.attention.pending_vacations}</strong><small>очікують рішення</small>
            </Link>
            <Link href={`/${base}/applications`} className="attention-card soft">
              <span>Нові заявки</span><strong>{data.attention.new_leads}</strong><small>у воронці</small>
            </Link>
          </div>
        </section>
      </div>

      <div className="dashboard-bottom-grid">
        <section className="card glass-panel">
          <div className="panel-head">
            <div><span className="panel-kicker">Останні операції</span><h2>Оплати</h2></div>
            <Link className="text-link" href={role === "ADMIN" ? "/admin/finance" : "/manager/payments"}>Всі оплати →</Link>
          </div>
          <div className="payment-preview-list">
            {payments.map((payment) => <div className="payment-preview-row" key={payment.id}>
              <div className="payment-preview-date">{dateTime(payment.paid_at ?? payment.created_at)}</div>
              <div className="payment-preview-copy">
                <strong>{payment.student_last_name || payment.parent_last_name} {payment.student_first_name || payment.parent_first_name}</strong>
                <span>{payment.subject_name ?? "Інша оплата"}</span>
              </div>
              <strong className="payment-preview-amount">{money(payment.total_minor, payment.currency)}</strong>
              <span className={`badge ${payment.status === "PAID" ? "paid" : "booked"}`}>{payment.status === "PAID" ? "Оплачено" : payment.status}</span>
            </div>)}
            {!payments.length && <div className="empty compact-empty">Оплат поки немає.</div>}
          </div>
        </section>

        <section className="card glass-panel dashboard-pulse">
          <div className="panel-head"><div><span className="panel-kicker">Навчання</span><h2>Поточний ритм</h2></div></div>
          <div className="pulse-grid">
            <div><span>Перших уроків цього місяця</span><strong>{data.metrics.first_lessons_month}</strong></div>
            <div><span>Активних доступів до курсів</span><strong>{data.metrics.active_course_licenses}</strong></div>
            <div><span>Проведено цього місяця</span><strong>{data.learning.conducted}</strong></div>
            <div><span>Списаних no-show</span><strong>{data.learning.charged_no_show}</strong></div>
          </div>
          {role === "ADMIN" && data.finance && <div className="finance-strip">
            <div><span>Надходження за місяць</span><strong>{money(data.finance.month_revenue_minor)}</strong></div>
            <div><span>Нараховано викладачам</span><strong>{money(data.finance.month_teacher_accrual_minor)}</strong></div>
          </div>}
          <div className="dashboard-quick-actions">
            <Link className="btn secondary" href={`/${base}/students`}>Учні</Link>
            <Link className="btn secondary" href={`/${base}/teachers`}>Викладачі</Link>
            <Link className="btn" href={`/${base}/schedule`}>Відкрити розклад</Link>
          </div>
        </section>
      </div>
    </div>}
  </PlatformShell>;
}
