"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { kyivDateValue, kyivLocalDateTimeToIso } from "../lib/format";
import { NewStudentWizard } from "./new-student-wizard";
import { TimeSelect24 } from "./time-select-24";

type Status = "NEW" | "CONTACTED" | "FIRST_LESSON" | "CONVERTED" | "LOST";
type Slot = { dayOfWeek: number; startTime: string; durationMinutes: 30 | 60 };
const labels: Record<Status, string> = {
  NEW: "Нова", CONTACTED: "Звʼязалися", FIRST_LESSON: "Записались на перше заняття",
  CONVERTED: "Записались на регулярні заняття", LOST: "Відмовились",
};
const weekdays = ["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];

export function LeadWorkflow({ lead: initial, status: initialStatus, role, onClose, onSaved }: {
  lead: any; status: Status; role: "ADMIN" | "MANAGER"; onClose: () => void; onSaved: () => void;
}) {
  const [lead, setLead] = useState(initial);
  const [status, setStatus] = useState<Status>(initialStatus);
  const [reason, setReason] = useState(initial.refusal_reason ?? "");
  const [studentId, setStudentId] = useState(initial.converted_student_id ?? "");
  const [familyId, setFamilyId] = useState(initial.converted_family_id ?? "");
  const [studentSearch, setStudentSearch] = useState(initial.student_first_name ?? "");
  const [matches, setMatches] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [teachers, setTeachers] = useState<any[]>([]);
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [subjectId, setSubjectId] = useState(initial.subject_id ?? "");
  const [teacherId, setTeacherId] = useState("");
  const [date, setDate] = useState(() => kyivDateValue(new Date(), 1));
  const [time, setTime] = useState("17:00");
  const [slots, setSlots] = useState<Slot[]>([{ dayOfWeek: 1, startTime: "17:00", durationMinutes: 60 }]);
  const [sessionId, setSessionId] = useState(initial.first_lesson_session_id ?? "");
  const [enrollmentId, setEnrollmentId] = useState(initial.converted_enrollment_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const teacherOptions = useMemo(() => teachers.filter((row: any) =>
    row.teacherStatus === "ACTIVE" && !row.archivedAt &&
    (row.subjects ?? []).some((s: any) => s.id === subjectId && s.isActive),
  ), [teachers, subjectId]);

  useEffect(() => {
    Promise.all([api<any[]>("/subjects"), api<any[]>("/teachers")])
      .then(([ss, tt]) => { setSubjects(ss.filter((s: any) => s.status === "ACTIVE")); setTeachers(tt); })
      .catch((value: any) => setError(value.message));
    if (studentId) void api<any[]>(`/students/${studentId}/enrollments`).then(setEnrollments).catch((value: any) => setError(value.message));
  }, []);

  async function linkStudent(id: string, knownFamily?: string) {
    setBusy(true); setError("");
    try {
      const student = knownFamily ? { familyId: knownFamily } : await api<any>(`/students/${id}`);
      const updated = await api<any>(`/leads/${lead.id}`, {
        method: "PATCH", body: JSON.stringify({ convertedFamilyId: student.familyId, convertedStudentId: id }),
      });
      setLead(updated); setStudentId(id); setFamilyId(student.familyId); setMatches([]);
      setEnrollments(await api<any[]>(`/students/${id}/enrollments`));
      setMessage("Учня привʼязано до заявки.");
      onSaved();
    } catch (value: any) { setError(value.message ?? "Не вдалося привʼязати учня."); }
    finally { setBusy(false); }
  }

  async function searchStudents() {
    if (studentSearch.trim().length < 2) { setError("Введіть щонайменше два символи для пошуку."); return; }
    setBusy(true); setError("");
    try { setMatches(await api<any[]>(`/ops/students?lifecycle=ACTIVE&search=${encodeURIComponent(studentSearch.trim())}`)); }
    catch (value: any) { setError(value.message ?? "Не вдалося знайти учнів."); }
    finally { setBusy(false); }
  }

  async function save() {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (status === "LOST") {
        if (!reason.trim()) throw new Error("Вкажіть причину відмови.");
        await api(`/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ status, refusalReason: reason.trim() }) });
      } else if (status === "FIRST_LESSON") {
        if (!studentId || !familyId || (!sessionId && (!subjectId || !teacherId))) throw new Error("Оберіть учня, предмет і викладача.");
        let id = sessionId;
        if (!id) {
          const startsAt = kyivLocalDateTimeToIso(`${date}T${time}`);
          if (new Date(startsAt).getTime() <= Date.now()) throw new Error("Оберіть майбутні дату й час.");
          const created = await api<any>("/first-lessons", {
            method: "POST", body: JSON.stringify({ studentId, subjectId, teacherId, startsAt }),
          });
          id = created.id; setSessionId(id);
          await api(`/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ convertedFamilyId: familyId, convertedStudentId: studentId, firstLessonSessionId: id }) });
        }
        await api(`/leads/${lead.id}`, {
          method: "PATCH", body: JSON.stringify({ status, convertedFamilyId: familyId, convertedStudentId: studentId, firstLessonSessionId: id }),
        });
      } else if (status === "CONVERTED") {
        if (!studentId || !familyId || !subjectId || !teacherId) throw new Error("Оберіть учня, предмет і викладача.");
        let id = enrollmentId;
        if (!id) {
          const existing = enrollments.find((e: any) => e.subject?.id === subjectId && e.status === "ACTIVE");
          id = existing?.id ?? (await api<any>(`/students/${studentId}/enrollments`, {
            method: "POST", body: JSON.stringify({ subjectId, defaultDurationMinutes: slots[0].durationMinutes }),
          })).id;
          setEnrollmentId(id);
        }
        await api(`/enrollments/${id}/assign-teacher`, { method: "POST", body: JSON.stringify({ teacherId }) });
        await api(`/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ convertedFamilyId: familyId, convertedStudentId: studentId, convertedEnrollmentId: id }) });
        const versions = await api<any[]>(`/enrollments/${id}/schedule`);
        const sameDate = versions.find((version: any) => !version.effectiveUntil && version.effectiveFrom === date);
        if (sameDate) {
          const sameSlots = sameDate.slots.length === slots.length && slots.every(slot => sameDate.slots.some((saved: any) =>
            saved.dayOfWeek === slot.dayOfWeek && String(saved.startTime).slice(0, 5) === slot.startTime && saved.durationMinutes === slot.durationMinutes));
          if (!sameSlots) throw new Error("На цю дату вже є інший графік. Змініть дату або відкрийте графік у картці учня.");
        } else {
          await api(`/enrollments/${id}/schedule`, { method: "PUT", body: JSON.stringify({ effectiveFrom: date, slots }) });
        }
        await api(`/leads/${lead.id}`, {
          method: "PATCH", body: JSON.stringify({ status, convertedFamilyId: familyId, convertedStudentId: studentId, convertedEnrollmentId: id }),
        });
      } else {
        await api(`/leads/${lead.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      }
      onSaved(); onClose();
    } catch (value: any) {
      setError(value.message ?? "Не вдалося зберегти заявку.");
      if (sessionId || enrollmentId) setMessage("Частину налаштувань уже збережено. Перевірте урок або графік перед повторною спробою.");
    } finally { setBusy(false); }
  }

  return <div className="sheet-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <aside className="sheet wide-sheet" onClick={event => event.stopPropagation()}>
      <button className="sheet-close" type="button" aria-label="Закрити заявку" disabled={busy} onClick={onClose}>×</button>
      <div className="stack management-sheet-body" style={{ marginTop: 40 }}>
        <h2>Заявка · {lead.parent_first_name ?? lead.phone}</h2>
        <p className="muted">{lead.phone} · {lead.email ?? "email не вказано"} · {lead.student_first_name ?? "учень не вказаний"}</p>
        {error && <div className="error" role="alert">{error}</div>}
        {message && <div className="warning-note">{message}</div>}
        <div className="field"><label htmlFor="lead-status">Статус</label><select id="lead-status" className="select" value={status} onChange={event => setStatus(event.target.value as Status)}>{(Object.keys(labels) as Status[]).map(value => <option key={value} value={value}>{labels[value]}</option>)}</select></div>

        {(status === "FIRST_LESSON" || status === "CONVERTED") && <>
          <h3>Учень і сімʼя</h3>
          {studentId ? <div className="row wrap-row"><span className="badge paid">Учня привʼязано</span><Link href={`${role === "ADMIN" ? "/admin" : "/manager"}/students/${studentId}`}>Відкрити картку учня</Link></div> : <>
            <p className="muted">Знайдіть наявного учня або створіть нову сімʼю з даних заявки.</p>
            <div className="row wrap-row"><input className="input" aria-label="Пошук учня" value={studentSearch} onChange={event => setStudentSearch(event.target.value)} /><button className="btn secondary" type="button" disabled={busy} onClick={() => void searchStudents()}>Знайти учня</button></div>
            {matches.map((item: any) => <div className="row" key={item.id}><span>{item.last_name} {item.first_name} · {item.parent_last_name} {item.parent_first_name}</span><button className="btn secondary" type="button" disabled={busy} onClick={() => void linkStudent(item.id)}>Привʼязати</button></div>)}
            <NewStudentWizard role={role} createOnly buttonLabel="+ Створити сімʼю з заявки"
              initial={{ parentFirstName: lead.parent_first_name ?? "", parentLastName: lead.parent_last_name ?? "", email: lead.email ?? "", phone: lead.phone ?? "", studentFirstName: lead.student_first_name ?? "", studentLastName: lead.student_last_name ?? "", gradeLevel: lead.grade_level ?? "" }}
              onDone={result => { if (result) void linkStudent(result.studentId, result.familyId); }} />
          </>}
          <div className="field"><label htmlFor="lead-subject">Предмет</label><select id="lead-subject" className="select" value={subjectId} onChange={event => { setSubjectId(event.target.value); setTeacherId(""); setEnrollmentId(""); }}><option value="">Оберіть предмет</option>{subjects.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div className="field"><label htmlFor="lead-teacher">Викладач</label><select id="lead-teacher" className="select" value={teacherId} onChange={event => setTeacherId(event.target.value)}><option value="">Оберіть викладача</option>{teacherOptions.map((item: any) => <option key={item.userId} value={item.userId}>{item.lastName} {item.firstName}</option>)}</select></div>
          <div className="field"><label htmlFor="lead-date">{status === "FIRST_LESSON" ? "Дата першого уроку" : "Початок регулярного графіка"}</label><input id="lead-date" className="input" type="date" min={kyivDateValue()} value={date} onChange={event => setDate(event.target.value)} /></div>
          {status === "FIRST_LESSON" ? <>{sessionId && <p className="muted">Перший урок уже створено. Час можна змінити в календарі.</p>}<div className="field"><label htmlFor="lead-time">Час першого уроку</label><TimeSelect24 id="lead-time" value={time} onChange={setTime} disabled={Boolean(sessionId)} /></div></> : <>
            <div className="row"><strong>Регулярні години</strong><button className="btn secondary" type="button" onClick={() => setSlots(current => [...current, { dayOfWeek: 1, startTime: "17:00", durationMinutes: 60 }])}>+ Додати час</button></div>
            {slots.map((slot, index) => <div className="row wrap-row" key={index}>
              <select className="select" aria-label="День" value={slot.dayOfWeek} onChange={event => setSlots(current => current.map((item, i) => i === index ? { ...item, dayOfWeek: Number(event.target.value) } : item))}>{weekdays.slice(1).map((day, i) => <option key={i + 1} value={i + 1}>{day}</option>)}</select>
              <TimeSelect24 value={slot.startTime} onChange={value => setSlots(current => current.map((item, i) => i === index ? { ...item, startTime: value } : item))} />
              <select className="select" aria-label="Тривалість" value={slot.durationMinutes} onChange={event => setSlots(current => current.map((item, i) => i === index ? { ...item, durationMinutes: Number(event.target.value) as 30 | 60 } : item))}><option value={60}>60 хв</option><option value={30}>30 хв</option></select>
              <button className="btn secondary" type="button" disabled={slots.length === 1} onClick={() => setSlots(current => current.filter((_, i) => i !== index))}>×</button>
            </div>)}
          </>}
        </>}
        {status === "LOST" && <div className="field"><label htmlFor="lead-refusal">Чому відмовились *</label><textarea id="lead-refusal" className="textarea" maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></div>}
        <button type="button" className="btn" disabled={busy || ((status === "FIRST_LESSON" || status === "CONVERTED") && !studentId)} onClick={() => void save()}>{busy ? "Зберігаємо…" : status === "FIRST_LESSON" ? "Запланувати перше заняття" : status === "CONVERTED" ? "Зберегти регулярний графік" : "Зберегти статус"}</button>
      </div>
    </aside>
  </div>;
}
