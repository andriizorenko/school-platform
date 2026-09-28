"use client";

import Link from "next/link";
import { dateTime, lessonCount, phoneNumber } from "../lib/format";
import { useData } from "../lib/use-data";
import { ErrorCard, LoadingCard } from "./loadable";
import { PlatformShell } from "./platform-shell";

export function ParentDashboard() {
  const { data, error, loading } = useData<any>("/parent/dashboard");

  return (
    <PlatformShell allowedRoles={["PARENT"]}>
      <div className="page-head">
        <div>
          <h1>Вітаємо{data?.parent?.firstName ? `, ${data.parent.firstName}` : ""}</h1>
          <p className="muted">Найближчі заняття, баланси дітей і навчання.</p>
        </div>
      </div>

      {loading ? <LoadingCard /> : error ? <ErrorCard error={error} /> : data && (
        <div className="stack parent-dashboard">
          {data.students.length ? (
            <div className="grid cols-2 parent-dashboard-students">
              {data.students.map((student: any) => (
                <section className="card parent-student-card" key={student.id}>
                  <h2>{student.lastName} {student.firstName}</h2>

                  {student.enrollments.length ? (
                    <div className="stack">
                      {student.enrollments.map((enrollment: any) => (
                        <div key={enrollment.id} className="row parent-enrollment-row">
                          <div>
                            <strong>{enrollment.subject.name}</strong>
                            <div className="muted">
                              {enrollment.primaryTeacher
                                ? `${enrollment.primaryTeacher.lastName} ${enrollment.primaryTeacher.firstName}`
                                : "Без викладача"}
                            </div>
                          </div>
                          <span className="badge">Залишилось: {lessonCount(enrollment.balanceLessonUnits)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty compact-empty">Активних предметів поки немає.</div>
                  )}

                  {student.primaryManager && (
                    <div className="muted parent-manager-note">
                      Менеджер: {student.primaryManager.lastName} {student.primaryManager.firstName} · {phoneNumber(student.primaryManager.phone)}
                    </div>
                  )}
                </section>
              ))}
            </div>
          ) : (
            <div className="card empty">До цього акаунта ще не додано учнів.</div>
          )}

          <div className="parent-dashboard-section-head">
            <h2>Найближчі заняття</h2>
          </div>

          {data.nextLessons.length ? (
            <div className="grid cols-3">
              {data.nextLessons.map((lesson: any) => (
                <article className="card parent-lesson-card" key={lesson.id}>
                  <strong>{dateTime(lesson.starts_at ?? lesson.startsAt)}</strong>
                  <div>{lesson.subject_name ?? lesson.subjectName}</div>
                  <div className="muted">{lesson.student_first_name ?? ""} {lesson.student_last_name ?? ""}</div>
                  {lesson.zoom_url && (
                    <a className="btn" href={lesson.zoom_url} target="_blank" rel="noreferrer">
                      Приєднатися до Zoom
                    </a>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="card empty">Майбутніх занять поки немає.</div>
          )}

          <div className="row parent-dashboard-actions">
            <Link className="btn" href="/parent/schedule">Відкрити розклад</Link>
            <Link className="btn secondary" href="/parent/learning">Навчання і звіти</Link>
            <Link className="btn secondary" href="/parent/courses">Курси</Link>
          </div>
        </div>
      )}
    </PlatformShell>
  );
}
