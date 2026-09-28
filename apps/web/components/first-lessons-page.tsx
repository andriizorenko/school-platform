"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { kyivDateValue, kyivLocalDateTimeToIso } from "../lib/format";
import { PlatformShell } from "./platform-shell";
import { SchoolCalendar } from "./calendar";
import { TimeSelect24 } from "./time-select-24";

function localDate(days = 0) {
  return kyivDateValue(new Date(), days);
}

export function FirstLessonsPage() {
  const [students, setStudents] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [form, setForm] = useState({
    studentId: "",
    subjectId: "",
    teacherId: "",
    date: localDate(1),
    time: "17:00",
  });
  const [calendarVersion, setCalendarVersion] = useState(0);
  const [referencesLoading, setReferencesLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    Promise.all([
      api<any[]>("/ops/students?lifecycle=ACTIVE"),
      api<any[]>("/subjects"),
      api<any[]>("/teachers"),
    ]).then(([studentRows, subjectRows, teacherRows]) => {
      setStudents(studentRows);
      setSubjects(subjectRows.filter((item: any) => item.status === "ACTIVE"));
      setTeachers(teacherRows.filter((item: any) => item.teacherStatus === "ACTIVE" && !item.archivedAt));
    }).catch((exception: any) => setError(exception?.message ?? "Не вдалося завантажити дані для першого уроку"))
      .finally(() => setReferencesLoading(false));
  }, []);

  const teacherOptions = useMemo(() => teachers.filter((teacher: any) =>
    !form.subjectId || (teacher.subjects ?? []).some((subject: any) => subject.id === form.subjectId && subject.isActive),
  ), [teachers, form.subjectId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const startsAtIso = kyivLocalDateTimeToIso(`${form.date}T${form.time}`);
      const startsAt = new Date(startsAtIso);
      if (!Number.isFinite(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
        setError("Оберіть майбутню дату й час.");
        return;
      }
      await api("/first-lessons", {
        method: "POST",
        body: JSON.stringify({
          studentId: form.studentId,
          subjectId: form.subjectId,
          teacherId: form.teacherId,
          startsAt: startsAtIso,
        }),
      });
      setMessage("Перший урок заплановано. Тепер зафіксуйте оплату до початку заняття.");
      setCalendarVersion((value) => value + 1);
    } catch (exception: any) {
      setError(exception?.message ?? "Не вдалося запланувати перший урок");
    } finally {
      setBusy(false);
    }
  }

  return <PlatformShell allowedRoles={["MANAGER"]}>
    <div className="page-head">
      <div><h1>Перші уроки</h1><p className="muted">Заплануйте перше заняття, зафіксуйте оплату до початку та проконтролюйте звіт викладача.</p></div>
    </div>

    <form className="card stack first-lesson-form" onSubmit={submit}>
      <div className="page-head compact-page-head"><h2>Запланувати перший урок</h2><span className="badge">60 хв</span></div>
      {error && <div className="error" role="alert">{error}</div>}
      {message && <div className="success" role="status">{message}</div>}
      {referencesLoading && <div className="muted first-lesson-reference-status" role="status">Завантажуємо учнів, предмети та доступних викладачів…</div>}
      <div className="grid cols-2 first-lesson-fields">
        <div className="field"><label htmlFor="first-lesson-student">Учень *</label><select id="first-lesson-student" className="select" required disabled={referencesLoading} value={form.studentId} onChange={(event) => setForm({ ...form, studentId: event.target.value })}><option value="">{referencesLoading ? "Завантажуємо учнів…" : students.length ? "Оберіть учня" : "Немає активних учнів"}</option>{students.map((student: any) => <option key={student.id} value={student.id}>{student.last_name} {student.first_name}{student.grade_level ? ` · ${student.grade_level} клас` : ""}</option>)}</select></div>
        <div className="field"><label htmlFor="first-lesson-subject">Предмет *</label><select id="first-lesson-subject" className="select" required disabled={referencesLoading} value={form.subjectId} onChange={(event) => setForm({ ...form, subjectId: event.target.value, teacherId: "" })}><option value="">{referencesLoading ? "Завантажуємо предмети…" : subjects.length ? "Оберіть предмет" : "Немає активних предметів"}</option>{subjects.map((subject: any) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></div>
        <div className="field"><label htmlFor="first-lesson-teacher">Викладач *</label><select id="first-lesson-teacher" className="select" required disabled={referencesLoading || !form.subjectId || !teacherOptions.length} value={form.teacherId} onChange={(event) => setForm({ ...form, teacherId: event.target.value })}><option value="">{!form.subjectId ? "Спочатку оберіть предмет" : teacherOptions.length ? "Оберіть викладача" : "Немає активних викладачів"}</option>{teacherOptions.map((teacher: any) => <option key={teacher.userId} value={teacher.userId}>{teacher.lastName} {teacher.firstName}</option>)}</select></div>
        <div className="field"><label htmlFor="first-lesson-date">Дата *</label><input id="first-lesson-date" className="input" type="date" min={localDate()} required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></div>
        <div className="field"><label htmlFor="first-lesson-time">Час *</label><TimeSelect24 id="first-lesson-time" required value={form.time} onChange={(time) => setForm({ ...form, time })} /></div>
      </div>
      {form.subjectId && !referencesLoading && !teacherOptions.length && <div className="warning-note">Для цього предмета немає активного викладача. Перевірте призначені предмети та статус викладачів.</div>}
      <p className="muted first-lesson-form-note">Система перевірить предмет викладача, його доступність і конфлікти в календарі.</p>
      <button className="btn first-lesson-submit" disabled={referencesLoading || busy || !form.studentId || !form.subjectId || !form.teacherId}>{busy ? "Плануємо…" : "Запланувати перший урок"}</button>
    </form>

    <SchoolCalendar key={calendarVersion} role="MANAGER" query="sessionType=FIRST" />
  </PlatformShell>;
}
