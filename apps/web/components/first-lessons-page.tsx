"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { kyivLocalDateTimeToIso } from "../lib/format";
import { PlatformShell } from "./platform-shell";
import { SchoolCalendar } from "./calendar";
import { TimeSelect24 } from "./time-select-24";

function localDate(days = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const date = new Date(Date.UTC(value("year"), value("month") - 1, value("day") + days));
  return date.toISOString().slice(0, 10);
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
    }).catch((exception: any) => setError(exception?.message ?? "Не вдалося завантажити дані для першого уроку"));
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

    <form className="card stack" onSubmit={submit} style={{ marginBottom: 16 }}>
      <div className="page-head compact-page-head"><h2>Запланувати перший урок</h2><span className="badge">60 хв</span></div>
      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}
      <div className="grid cols-2">
        <div className="field"><label>Учень *</label><select className="select" required value={form.studentId} onChange={(event) => setForm({ ...form, studentId: event.target.value })}><option value="">Оберіть учня</option>{students.map((student: any) => <option key={student.id} value={student.id}>{student.last_name} {student.first_name}{student.grade_level ? ` · ${student.grade_level} клас` : ""}</option>)}</select></div>
        <div className="field"><label>Предмет *</label><select className="select" required value={form.subjectId} onChange={(event) => setForm({ ...form, subjectId: event.target.value, teacherId: "" })}><option value="">Оберіть предмет</option>{subjects.map((subject: any) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></div>
        <div className="field"><label>Викладач *</label><select className="select" required disabled={!form.subjectId} value={form.teacherId} onChange={(event) => setForm({ ...form, teacherId: event.target.value })}><option value="">Оберіть викладача</option>{teacherOptions.map((teacher: any) => <option key={teacher.userId} value={teacher.userId}>{teacher.lastName} {teacher.firstName}</option>)}</select></div>
        <div className="field"><label>Дата *</label><input className="input" type="date" min={localDate()} required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></div>
        <div className="field"><label htmlFor="first-lesson-time">Час *</label><TimeSelect24 id="first-lesson-time" required value={form.time} onChange={(time) => setForm({ ...form, time })} /></div>
      </div>
      <p className="muted">Система перевірить предмет викладача, його доступність і конфлікти в календарі.</p>
      <button className="btn" disabled={busy || !form.studentId || !form.subjectId || !form.teacherId}>{busy ? "Плануємо…" : "Запланувати перший урок"}</button>
    </form>

    <SchoolCalendar key={calendarVersion} role="MANAGER" query="sessionType=FIRST" />
  </PlatformShell>;
}
