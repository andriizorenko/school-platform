"use client";

import Link from "next/link";
import { PlatformShell } from "./platform-shell";
import { useData } from "../lib/use-data";
import { ErrorCard, LoadingCard } from "./loadable";
import { dateTime } from "../lib/format";

export function StudentDashboard() {
  const { data, error, loading } = useData<any>("/student/dashboard");
  const firstName = data?.student?.firstName ?? data?.student?.first_name;
  const lastName = data?.student?.lastName ?? data?.student?.last_name;
  const nearest = data?.nextLessons?.[0];

  return <PlatformShell allowedRoles={["STUDENT"]}>
    <div className="page-head">
      <div>
        <h1>{data ? `${lastName} ${firstName}` : "Головна"}</h1>
        <p className="muted">Твій розклад, залишок занять, викладачі та навчальний прогрес.</p>
      </div>
      <div className="row">
        <Link className="btn" href="/student/schedule">Розклад</Link>
        <Link className="btn secondary" href="/student/journal">Журнал</Link>
        <Link className="btn secondary" href="/student/courses">Курси</Link>
      </div>
    </div>

    {loading ? <LoadingCard /> : error ? <ErrorCard error={error} /> : data && <div className="stack student-home-page">
      {nearest && <section className="card student-next-lesson-hero">
        <div>
          <div className="muted">Найближче заняття</div>
          <h2>{nearest.subjectName ?? nearest.subject_name}</h2>
          <strong>{dateTime(nearest.startsAt ?? nearest.starts_at)}</strong>
          <div className="muted">{nearest.teacherLastName ?? nearest.teacher_last_name} {nearest.teacherFirstName ?? nearest.teacher_first_name}</div>
        </div>
        <div className="row">
          {(nearest.zoomUrl ?? nearest.zoom_url) && <a className="btn" href={nearest.zoomUrl ?? nearest.zoom_url} target="_blank" rel="noreferrer">Приєднатися до Zoom</a>}
          <Link className="btn secondary" href="/student/schedule">Весь розклад</Link>
        </div>
      </section>}

      <div className="grid cols-3">
        {data.enrollments.map((enrollment: any) => {
          const teacher = enrollment.primaryTeacher;
          return <article className="card student-home-subject-card" key={enrollment.id}>
            <div className="row subject-line"><h2>{enrollment.subject.name}</h2><span className={`badge ${enrollment.status === "ACTIVE" ? "success-badge" : enrollment.status === "PAUSED" ? "booked" : ""}`}>{enrollment.status === "ACTIVE" ? "Активне" : enrollment.status === "PAUSED" ? "Пауза" : "Неактивне"}</span></div>
            <div className="metric">{enrollment.balanceLessonUnits}</div>
            <div className="muted">занять залишилось</div>
            {teacher && <div className="student-home-teacher"><strong>{teacher.lastName} {teacher.firstName}</strong>{teacher.phone && <a className="muted" href={`tel:${teacher.phone}`}>{teacher.phone}</a>}</div>}
            <Link className="btn secondary" href="/student/journal">Журнал і прогрес</Link>
          </article>;
        })}
      </div>

      {!nearest && <div className="card empty">Майбутніх занять поки немає.</div>}
    </div>}
  </PlatformShell>;
}
