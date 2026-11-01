"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, type Me } from "../lib/api";
import { kyivDateValue } from "../lib/format";
import { TimeSelect24 } from "./time-select-24";
import { TeacherScheduleMatcher } from "./teacher-schedule-matcher";

const dayNames = ["", "Понеділок", "Вівторок", "Середа", "Четвер", "Пʼятниця", "Субота", "Неділя"];
type Slot = { dayOfWeek: number; startTime: string; durationMinutes: 30 | 60 };

function todayDate() {
  return kyivDateValue();
}

export function NewStudentWizard({ role, onDone, buttonLabel = "+ Новий учень", initial, createOnly = false }: { role: "ADMIN" | "MANAGER"; onDone: (result?: { familyId: string; studentId: string }) => void; buttonLabel?: string; initial?: Partial<{ parentFirstName: string; parentLastName: string; email: string; phone: string; studentFirstName: string; studentLastName: string; gradeLevel: number | string; subjectId: string }>; createOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [managers, setManagers] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedTeacher, setSelectedTeacher] = useState<any>(null);
  const [slots, setSlots] = useState<Slot[]>([
    { dayOfWeek: 2, startTime: "17:00", durationMinutes: 60 },
    { dayOfWeek: 4, startTime: "17:00", durationMinutes: 60 },
  ]);
  const [form, setForm] = useState<any>({
    parentFirstName: "",
    parentLastName: "",
    email: "",
    phone: "",
    studentFirstName: "",
    studentLastName: "",
    gradeLevel: "",
    studentAccountEmail: "",
    subjectId: "",
    managerUserId: "",
    effectiveFrom: todayDate(),
  });

  useEffect(() => {
    if (!open) return;
    Promise.all([api<any[]>("/subjects"), api<any[]>("/staff/managers"), api<{ user: Me }>("/auth/me")])
      .then(([subjectRows, managerRows, current]) => {
        setSubjects(subjectRows.filter((subject: any) => subject.status === "ACTIVE"));
        setManagers(managerRows);
        setForm((previous: any) => ({ ...previous, managerUserId: role === "MANAGER" ? current.user.id : previous.managerUserId }));
      })
      .catch((exception: any) => setError(exception.message));
  }, [open, role]);

  const canMatch = Boolean(form.subjectId && form.effectiveFrom && slots.length);
  const selectedSubject = useMemo(() => subjects.find((subject) => subject.id === form.subjectId), [subjects, form.subjectId]);

  function field(name: string, value: any) {
    setForm((previous: any) => ({ ...previous, [name]: value }));
    if (name === "subjectId" || name === "effectiveFrom") setSelectedTeacher(null);
  }

  function patchSlot(index: number, patch: Partial<Slot>) {
    setSlots((current) => current.map((slot, currentIndex) => currentIndex === index ? { ...slot, ...patch } : slot));
    setSelectedTeacher(null);
  }

  function addSlot() {
    setSlots((current) => [...current, { dayOfWeek: 1, startTime: "17:00", durationMinutes: 60 }]);
    setSelectedTeacher(null);
  }

  function removeSlot(index: number) {
    setSlots((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setSelectedTeacher(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const family = await api<any>("/families", {
        method: "POST",
        body: JSON.stringify({
          parent: {
            email: form.email,
            firstName: form.parentFirstName,
            lastName: form.parentLastName,
            phone: form.phone,
          },
        }),
      });
      const student = await api<any>(`/families/${family.id}/students`, {
        method: "POST",
        body: JSON.stringify({
          firstName: form.studentFirstName,
          lastName: form.studentLastName,
          gradeLevel: form.gradeLevel ? Number(form.gradeLevel) : undefined,
          studentAccountEmail: form.studentAccountEmail || undefined,
        }),
      });

      if (form.managerUserId) {
        await api(`/students/${student.id}/primary-manager`, {
          method: "POST",
          body: JSON.stringify({ managerUserId: form.managerUserId }),
        });
      }

      if (!createOnly && form.subjectId) {
        const durationMinutes = slots[0]?.durationMinutes ?? 60;
        const enrollment = await api<any>(`/students/${student.id}/enrollments`, {
          method: "POST",
          body: JSON.stringify({ subjectId: form.subjectId, defaultDurationMinutes: durationMinutes }),
        });

        if (selectedTeacher) {
          await api(`/enrollments/${enrollment.id}/assign-teacher`, {
            method: "POST",
            body: JSON.stringify({ teacherId: selectedTeacher.teacherId }),
          });
          if (slots.length) {
            await api(`/enrollments/${enrollment.id}/schedule`, {
              method: "PUT",
              body: JSON.stringify({ effectiveFrom: form.effectiveFrom, slots }),
            });
          }
        }
      }

      await api(`/users/${family.parent.userId}/invite`, { method: "POST" }).catch(() => null);
      if (student.userId) await api(`/users/${student.userId}/invite`, { method: "POST" }).catch(() => null);
      setOpen(false);
      onDone({ familyId: family.id, studentId: student.id });
    } catch (exception: any) {
      setError(exception.message ?? "Не вдалося створити учня");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button className="btn" type="button" onClick={() => { if (initial) setForm((previous: any) => ({ ...previous, ...initial, gradeLevel: initial.gradeLevel ?? "" })); setOpen(true); }}>{buttonLabel}</button>
    {open && <div className="sheet-backdrop" onClick={() => setOpen(false)}>
      <aside className="sheet wide-sheet onboarding-sheet" onClick={(event) => event.stopPropagation()}>
        <button className="sheet-close" onClick={() => setOpen(false)}>×</button>
        <form className="stack" style={{ marginTop: 40 }} onSubmit={submit}>
          <div><h2>Нова сімʼя та учень</h2><p className="muted">Одразу можемо підібрати викладача під бажаний регулярний графік.</p></div>
          {error && <div className="error">{error}</div>}

          <section className="stack onboarding-section">
            <h3>1. Батьківський акаунт</h3>
            <div className="grid cols-2">
              <div className="field"><label>Імʼя *</label><input className="input" required value={form.parentFirstName} onChange={(event) => field("parentFirstName", event.target.value)} /></div>
              <div className="field"><label>Прізвище *</label><input className="input" required value={form.parentLastName} onChange={(event) => field("parentLastName", event.target.value)} /></div>
              <div className="field"><label>Email *</label><input className="input" type="email" required value={form.email} onChange={(event) => field("email", event.target.value)} /></div>
              <div className="field"><label>Телефон *</label><input className="input" required value={form.phone} onChange={(event) => field("phone", event.target.value)} /></div>
            </div>
          </section>

          <section className="stack onboarding-section">
            <h3>2. Дитина</h3>
            <div className="grid cols-2">
              <div className="field"><label>Імʼя *</label><input className="input" required value={form.studentFirstName} onChange={(event) => field("studentFirstName", event.target.value)} /></div>
              <div className="field"><label>Прізвище *</label><input className="input" required value={form.studentLastName} onChange={(event) => field("studentLastName", event.target.value)} /></div>
              <div className="field"><label>Клас</label><input className="input" type="number" min="1" max="12" value={form.gradeLevel} onChange={(event) => field("gradeLevel", event.target.value)} /></div>
              <div className="field"><label>Email дитини (необовʼязково)</label><input className="input" type="email" value={form.studentAccountEmail} onChange={(event) => field("studentAccountEmail", event.target.value)} /></div>
            </div>
          </section>

          {!createOnly && <section className="stack onboarding-section">
            <h3>3. Навчання і бажаний графік</h3>
            <div className="grid cols-2">
              <div className="field"><label>Предмет</label><select className="select" value={form.subjectId} onChange={(event) => field("subjectId", event.target.value)}><option value="">Додати пізніше</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></div>
              <div className="field"><label>Початок регулярного графіка</label><input className="input" type="date" value={form.effectiveFrom} onChange={(event) => field("effectiveFrom", event.target.value)} /></div>
              {role === "ADMIN" && <div className="field"><label>Primary manager</label><select className="select" value={form.managerUserId} onChange={(event) => field("managerUserId", event.target.value)}><option value="">Не призначено</option>{managers.map((manager) => <option key={manager.userId} value={manager.userId}>{manager.lastName} {manager.firstName}</option>)}</select></div>}
            </div>

            {form.subjectId && <div className="schedule-builder stack">
              <div className="row" style={{ justifyContent: "space-between" }}><strong>Бажані години</strong><button className="btn secondary" type="button" onClick={addSlot}>+ Додати час</button></div>
              {slots.map((slot, index) => <div className="schedule-builder-row" key={index}>
                <select className="select" value={slot.dayOfWeek} onChange={(event) => patchSlot(index, { dayOfWeek: Number(event.target.value) })}>{Array.from({ length: 7 }, (_, dayIndex) => dayIndex + 1).map((day) => <option key={day} value={day}>{dayNames[day]}</option>)}</select>
                <TimeSelect24 value={slot.startTime} onChange={(startTime) => patchSlot(index, { startTime })} />
                <select className="select" value={slot.durationMinutes} onChange={(event) => patchSlot(index, { durationMinutes: Number(event.target.value) as 30 | 60 })}><option value={60}>60 хв</option><option value={30}>30 хв</option></select>
                <button className="btn secondary" type="button" disabled={slots.length === 1} onClick={() => removeSlot(index)}>×</button>
              </div>)}
            </div>}

            {canMatch && <TeacherScheduleMatcher
              subjectId={form.subjectId}
              effectiveFrom={form.effectiveFrom}
              slots={slots}
              selectedTeacherId={selectedTeacher?.teacherId}
              onSelect={setSelectedTeacher}
            />}
            {selectedTeacher && <div className="success">Обрано: <strong>{selectedTeacher.lastName} {selectedTeacher.firstName}</strong> · {selectedSubject?.name}. Після створення одразу призначимо викладача і регулярний графік.</div>}
          </section>}

          <button className="btn" disabled={busy}>{busy ? "Створюємо…" : createOnly ? "Створити сімʼю та учня" : selectedTeacher ? "Створити сімʼю, учня і графік" : "Створити та надіслати запрошення"}</button>
        </form>
      </aside>
    </div>}
  </>;
}
