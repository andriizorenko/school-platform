"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PlatformShell } from "./platform-shell";
import { ErrorCard, LoadingCard } from "./loadable";
import { useData } from "../lib/use-data";
import { dateTime } from "../lib/format";

const dayLabels: Record<number, string> = { 1: "Пн", 2: "Вт", 3: "Ср", 4: "Чт", 5: "Пт", 6: "Сб", 7: "Нд" };

function scheduleText(slots: any[]) {
  if (!slots?.length) return "Графік не задано";
  return slots.map((slot) => `${dayLabels[Number(slot.dayOfWeek)] ?? "—"} ${String(slot.startTime).slice(0, 5)}`).join(" · ");
}

export function TeacherStudentsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"ACTIVE" | "ARCHIVED">("ACTIVE");
  const path = useMemo(() => {
    const params = new URLSearchParams({ status });
    if (search.trim()) params.set("search", search.trim());
    return `/teachers/me/students?${params}`;
  }, [search, status]);
  const { data, error, loading } = useData<any[]>(path);

  return <PlatformShell allowedRoles={["TEACHER"]}>
    <div className="page-head">
      <div>
        <h1>Мої учні</h1>
        <p className="muted">Регулярні учні, графік, залишок занять і спільний журнал.</p>
      </div>
    </div>

    <div className="card teacher-student-toolbar">
      <input
        className="input"
        placeholder="Пошук за ім'ям або прізвищем"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="segmented" aria-label="Статус учнів">
        <button className={status === "ACTIVE" ? "active" : ""} onClick={() => setStatus("ACTIVE")}>Активні</button>
        <button className={status === "ARCHIVED" ? "active" : ""} onClick={() => setStatus("ARCHIVED")}>Архів</button>
      </div>
    </div>

    {loading ? <LoadingCard /> : error ? <ErrorCard error={error} /> : !(data?.length) ? <div className="card empty">{status === "ACTIVE" ? "Активних учнів поки немає" : "Архів порожній"}</div> : <div className="teacher-student-grid">
      {data.map((student: any) => <article className="card teacher-student-card" key={student.id}>
        <div className="teacher-student-card-head">
          <div>
            <Link href={`/teacher/students/${student.id}`} className="teacher-student-name">
              {student.last_name} {student.first_name}
            </Link>
            <div className="muted">{student.grade_level ? `${student.grade_level} клас` : "Клас не вказано"}</div>
          </div>
          {student.active ? <span className="badge success-badge">Активний</span> : <span className="badge">Архів</span>}
        </div>

        <div className="teacher-student-subjects">
          {(student.enrollments ?? []).map((enrollment: any) => <div className="teacher-student-subject" key={enrollment.id}>
            <div className="row subject-line">
              <strong>{enrollment.subjectName}</strong>
              {enrollment.status === "PAUSED" && <span className="badge">Пауза</span>}
            </div>
            <div className="muted">{scheduleText(enrollment.schedule)}</div>
            <div className="teacher-student-balance">
              <span>Залишилось</span>
              <strong>{Number(enrollment.balanceLessonUnits ?? 0)} заняття</strong>
            </div>
          </div>)}
        </div>

        {student.last_lesson_at && <div className="muted teacher-student-last">Останнє заняття: {dateTime(student.last_lesson_at)}</div>}
        <div className="row teacher-student-actions">
          <Link className="btn secondary" href={`/teacher/students/${student.id}#journal`}>Журнал</Link>
          <Link className="btn" href={`/teacher/students/${student.id}`}>Відкрити учня</Link>
        </div>
      </article>)}
    </div>}
  </PlatformShell>;
}
