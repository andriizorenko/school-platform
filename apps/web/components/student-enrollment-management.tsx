"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { kyivDateValue } from "../lib/format";
import { TimeSelect24 } from "./time-select-24";
import { TeacherScheduleMatcher } from "./teacher-schedule-matcher";

const dayNames = ["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];

type Slot = { dayOfWeek: number; startTime: string; durationMinutes: 30 | 60 };
type ScheduleVersion = { id: string; effectiveFrom: string; effectiveUntil?: string | null; slots: Slot[] };

type Props = {
  student: any;
  enrollment: any;
  balance: any;
  schedule: ScheduleVersion[];
  onChanged: () => void;
};

function dateOnly(date = new Date()) {
  return kyivDateValue(date);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function activeVersion(schedule: ScheduleVersion[]) {
  return schedule.find((version) => !version.effectiveUntil) ?? schedule.at(-1) ?? null;
}

export function StudentEnrollmentManagement({ student, enrollment, balance, schedule, onChanged }: Props) {
  const [mode, setMode] = useState<null | "teacher" | "schedule" | "topup" | "freeze" | "writeoff" | "transfer">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const current = useMemo(() => activeVersion(schedule), [schedule]);
  const currentSlots = (current?.slots ?? []) as Slot[];
  const today = dateOnly();
  const minimumScheduleDate = current?.effectiveFrom ? addDays(current.effectiveFrom > today ? current.effectiveFrom : today, 1) : today;

  const [scheduleDate, setScheduleDate] = useState(minimumScheduleDate);
  const [scheduleSlots, setScheduleSlots] = useState<Slot[]>(currentSlots.length ? currentSlots : [{ dayOfWeek: 2, startTime: "17:00", durationMinutes: 60 }]);
  const [selectedTeacher, setSelectedTeacher] = useState<any>(null);
  const [teachersWithoutSchedule, setTeachersWithoutSchedule] = useState<any[]>([]);
  const [topup, setTopup] = useState({ lessonUnits: "10", amount: "", paymentMethod: "BANK_TRANSFER" });
  const [note, setNote] = useState("");
  const [familyTargets, setFamilyTargets] = useState<any[]>([]);
  const [transfer, setTransfer] = useState({ toEnrollmentId: "", lessonUnits: "" });

  useEffect(() => {
    setScheduleDate(minimumScheduleDate);
    setScheduleSlots(currentSlots.length ? currentSlots : [{ dayOfWeek: 2, startTime: "17:00", durationMinutes: 60 }]);
  }, [enrollment.id, current?.id]);

  useEffect(() => {
    if (mode !== "teacher" || currentSlots.length) return;
    let cancelled = false;
    api<any[]>("/teachers")
      .then((rows) => {
        if (cancelled) return;
        setTeachersWithoutSchedule(rows.filter((teacher: any) =>
          teacher.teacherStatus === "ACTIVE"
          && (teacher.subjects ?? []).some((subject: any) => subject.id === enrollment.subject.id && subject.isActive),
        ));
      })
      .catch((exception: any) => !cancelled && setError(exception?.message ?? "Не вдалося завантажити викладачів"));
    return () => { cancelled = true; };
  }, [mode, currentSlots.length, enrollment.subject.id]);

  useEffect(() => {
    if (mode !== "transfer" || !student.familyId) return;
    let cancelled = false;
    (async () => {
      try {
        const family = await api<any>(`/families/${student.familyId}`);
        const otherStudents = (family.students ?? []).filter((item: any) => item.id !== student.id && !item.archivedAt);
        const lists = await Promise.all(otherStudents.map(async (item: any) => ({ student: item, enrollments: await api<any[]>(`/students/${item.id}/enrollments`) })));
        const targets = lists.flatMap(({ student: child, enrollments }) => enrollments
          .filter((item: any) => item.subject?.id === enrollment.subject.id && item.status !== "INACTIVE")
          .map((item: any) => ({ ...item, student: child })));
        if (!cancelled) {
          setFamilyTargets(targets);
          setTransfer((prev) => ({ ...prev, toEnrollmentId: targets[0]?.id ?? "" }));
        }
      } catch (exception: any) {
        if (!cancelled) setError(exception?.message ?? "Не вдалося завантажити дітей сімʼї");
      }
    })();
    return () => { cancelled = true; };
  }, [mode, student.familyId, student.id, enrollment.id, enrollment.subject.id]);

  function open(next: typeof mode) {
    setError(""); setMessage(""); setNote(""); setSelectedTeacher(null); setMode(next);
  }

  function patchSlot(index: number, patch: Partial<Slot>) {
    setScheduleSlots((rows) => rows.map((slot, i) => i === index ? { ...slot, ...patch } : slot));
  }

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError("");
    try {
      await action();
      setMessage(success);
      setMode(null);
      onChanged();
    } catch (exception: any) {
      setError(exception?.message ?? "Операцію не виконано");
    } finally {
      setBusy(false);
    }
  }

  async function saveTeacher() {
    if (!selectedTeacher?.teacherId) return;
    await run(
      () => api(`/enrollments/${enrollment.id}/change-primary-teacher`, { method: "POST", body: JSON.stringify({ teacherId: selectedTeacher.teacherId }) }),
      "Основного викладача змінено, майбутній графік збережено.",
    );
  }

  async function saveSchedule(event: FormEvent) {
    event.preventDefault();
    const normalizedSlots = scheduleSlots.map((slot) => ({
      dayOfWeek: Number(slot.dayOfWeek),
      startTime: String(slot.startTime).slice(0, 5),
      durationMinutes: Number(slot.durationMinutes),
    }));
    await run(
      () => api(`/enrollments/${enrollment.id}/schedule`, {
        method: "PUT",
        body: JSON.stringify({
          effectiveFrom: String(scheduleDate).slice(0, 10),
          slots: normalizedSlots,
        }),
      }),
      "Новий регулярний графік заплановано.",
    );
  }

  async function saveTopup(event: FormEvent) {
    event.preventDefault();
    const units = Number(topup.lessonUnits); const amount = Number(topup.amount);
    if (!units || Number.isNaN(amount)) return;
    await run(
      () => api(`/enrollments/${enrollment.id}/topups/manual`, { method: "POST", body: JSON.stringify({ lessonUnits: units, amountMinor: Math.round(amount * 100), paymentMethod: topup.paymentMethod }) }),
      "Баланс поповнено.",
    );
  }

  async function lifecycle(kind: "freeze" | "write-off") {
    await run(
      () => api(`/enrollments/${enrollment.id}/balance/${kind}`, { method: "POST", body: JSON.stringify({ note: note || undefined }) }),
      kind === "freeze" ? "Навчання призупинено, залишок заморожено." : "Навчання завершено, залишок списано.",
    );
  }

  async function reactivate() {
    await run(() => api(`/enrollments/${enrollment.id}/reactivate`, { method: "POST" }), "Навчання відновлено.");
  }

  async function saveTransfer(event: FormEvent) {
    event.preventDefault();
    await run(
      () => api(`/enrollments/${enrollment.id}/balance/transfer`, {
        method: "POST",
        body: JSON.stringify({ toEnrollmentId: transfer.toEnrollmentId, lessonUnits: Number(transfer.lessonUnits), requestedByParent: true, reason: note || "За запитом батьків" }),
      }),
      "Заняття перенесено іншій дитині сімʼї.",
    );
  }

  const transferable = Math.max(0, Number(balance?.balanceLessonUnits ?? 0) - Number(balance?.reservedLessonUnits ?? 0));

  return <div className="stack enrollment-management">
    {message && <div className="success">{message}</div>}
    <div className="enrollment-management-actions">
      <button className="btn" onClick={() => open("topup")}>+ Поповнити</button>
      {enrollment.status === "ACTIVE" && <button className="btn secondary" onClick={() => open("schedule")}>Змінити графік</button>}
      {enrollment.status !== "INACTIVE" && <button className="btn secondary" onClick={() => open("teacher")}>{enrollment.primaryTeacher ? "Змінити викладача" : "Призначити викладача"}</button>}
      {enrollment.status === "ACTIVE" && <button className="btn secondary" onClick={() => open("freeze")}>Призупинити</button>}
      {enrollment.status !== "INACTIVE" && <button className="btn secondary" onClick={() => open("transfer")}>Передати заняття</button>}
      {enrollment.status !== "INACTIVE" && <button className="btn danger" onClick={() => open("writeoff")}>Завершити навчання</button>}
      {enrollment.status !== "ACTIVE" && <button className="btn" onClick={reactivate} disabled={busy}>Відновити навчання</button>}
    </div>

    {error && !mode && <div className="error">{error}</div>}

    {mode && <div className="sheet-backdrop" onClick={() => !busy && setMode(null)}>
      <aside className={`sheet ${mode === "teacher" ? "wide-sheet" : ""}`} onClick={(event) => event.stopPropagation()}>
        <button className="sheet-close" onClick={() => !busy && setMode(null)}>×</button>
        <div className="stack management-sheet-body">
          {error && <div className="error">{error}</div>}

          {mode === "teacher" && <>
            <div><h2>{enrollment.primaryTeacher ? "Зміна основного викладача" : "Призначення викладача"}</h2><p className="muted">Система перевіряє, чи новий викладач може зберегти поточний регулярний графік і вже заплановані заняття.</p></div>
            {currentSlots.length ? <TeacherScheduleMatcher
              subjectId={enrollment.subject.id}
              effectiveFrom={today}
              slots={currentSlots}
              selectedTeacherId={selectedTeacher?.teacherId}
              onSelect={setSelectedTeacher}
            /> : <div className="stack">
              <div className="warning-note">Регулярного графіка ще немає, тому перевіряти match за годинами нічого. Оберіть активного викладача предмета, а графік задайте наступною дією.</div>
              <div className="field"><label>Викладач</label><select className="select" value={selectedTeacher?.teacherId ?? ""} onChange={(event) => {const teacher=teachersWithoutSchedule.find((item:any)=>item.userId===event.target.value);setSelectedTeacher(teacher?{teacherId:teacher.userId,firstName:teacher.firstName,lastName:teacher.lastName}:null);}}><option value="">Оберіть викладача</option>{teachersWithoutSchedule.map((teacher:any)=><option key={teacher.userId} value={teacher.userId}>{teacher.lastName} {teacher.firstName}</option>)}</select></div>
            </div>}
            <button className="btn" disabled={busy || !selectedTeacher?.teacherId} onClick={saveTeacher}>{busy ? "Зберігаємо…" : "Підтвердити зміну"}</button>
          </>}

          {mode === "schedule" && <form className="stack" onSubmit={saveSchedule}>
            <div><h2>Постійна зміна графіка</h2><p className="muted">Старий графік залишиться в історії. Нові години почнуть діяти з обраної дати.</p></div>
            <div className="field"><label>Діє з</label><input className="input" type="date" min={minimumScheduleDate} value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} required /></div>
            <div className="schedule-builder stack">
              <div className="row" style={{ justifyContent: "space-between" }}><strong>Регулярні години</strong><button type="button" className="btn secondary" onClick={() => setScheduleSlots((rows) => [...rows, { dayOfWeek: 1, startTime: "17:00", durationMinutes: enrollment.defaultDurationMinutes as 30 | 60 }])}>+ Додати</button></div>
              {scheduleSlots.map((slot, index) => <div className="schedule-builder-row" key={index}>
                <select className="select" value={slot.dayOfWeek} onChange={(event) => patchSlot(index, { dayOfWeek: Number(event.target.value) })}>{Array.from({ length: 7 }, (_, i) => i + 1).map((day) => <option value={day} key={day}>{dayNames[day]}</option>)}</select>
                <TimeSelect24 value={slot.startTime} onChange={(startTime) => patchSlot(index, { startTime })} />
                <select className="select" value={slot.durationMinutes} onChange={(event) => patchSlot(index, { durationMinutes: Number(event.target.value) as 30 | 60 })}><option value={60}>60 хв</option><option value={30}>30 хв</option></select>
                <button type="button" className="btn secondary" disabled={scheduleSlots.length === 1} onClick={() => setScheduleSlots((rows) => rows.filter((_, i) => i !== index))}>×</button>
              </div>)}
            </div>
            <button className="btn" disabled={busy}>{busy ? "Зберігаємо…" : "Зберегти новий графік"}</button>
          </form>}

          {mode === "topup" && <form className="stack" onSubmit={saveTopup}>
            <div><h2>Поповнити баланс</h2><p className="muted">Менеджер може вручну додати будь-яку кількість занять, у тому числі менше 10.</p></div>
            <div className="field"><label>Кількість занять</label><input className="input" min="0.5" step="0.5" type="number" value={topup.lessonUnits} onChange={(event) => setTopup((value) => ({ ...value, lessonUnits: event.target.value }))} required /></div>
            <div className="field"><label>Отримано, ₴</label><input className="input" min="0" step="0.01" type="number" value={topup.amount} onChange={(event) => setTopup((value) => ({ ...value, amount: event.target.value }))} required /></div>
            <div className="field"><label>Спосіб оплати</label><select className="select" value={topup.paymentMethod} onChange={(event) => setTopup((value) => ({ ...value, paymentMethod: event.target.value }))}><option value="BANK_TRANSFER">Переказ</option><option value="CARD">Картка</option><option value="CASH">Готівка</option><option value="OTHER">Інше</option></select></div>
            <button className="btn" disabled={busy}>{busy ? "Зберігаємо…" : "Поповнити"}</button>
          </form>}

          {mode === "freeze" && <div className="stack"><div><h2>Призупинити навчання</h2><p className="muted">Майбутні години звільняться, а невикористаний баланс залишиться за учнем і може бути відновлений пізніше.</p></div><div className="field"><label>Коментар</label><textarea className="input" value={note} onChange={(event) => setNote(event.target.value)} /></div><button className="btn" disabled={busy} onClick={() => lifecycle("freeze")}>Заморозити баланс</button></div>}

          {mode === "writeoff" && <div className="stack"><div><h2>Завершити навчання</h2><p className="muted">Невикористаний залишок буде списаний через ledger, а предмет стане неактивним. Операція залишиться в audit log.</p></div><div className="field"><label>Підстава / домовленість з батьками</label><textarea className="input" value={note} onChange={(event) => setNote(event.target.value)} /></div><button className="btn danger" disabled={busy} onClick={() => lifecycle("write-off")}>Списати залишок і завершити</button></div>}

          {mode === "transfer" && <form className="stack" onSubmit={saveTransfer}>
            <div><h2>Передати заняття іншій дитині</h2><p className="muted">Можна переносити лише між дітьми цієї сімʼї в тому самому предметі. Компенсаційні кредити викладача не передаються.</p></div>
            <div className="card compact-card"><span className="muted">Доступно без активних резервів</span><strong>{transferable} заняття</strong></div>
            <div className="field"><label>Кому</label><select className="select" value={transfer.toEnrollmentId} onChange={(event) => setTransfer((value) => ({ ...value, toEnrollmentId: event.target.value }))} required><option value="">Оберіть дитину</option>{familyTargets.map((target) => <option key={target.id} value={target.id}>{target.student.lastName} {target.student.firstName} · {target.subject.name}</option>)}</select></div>
            {transferable <= 0 && <div className="warning-note">Усі доступні заняття зараз зарезервовані під майбутній графік. Щоб передати заняття іншій дитині, спочатку призупиніть навчання — резерви звільняться, а баланс залишиться доступним для передачі.</div>}{!familyTargets.length && <div className="warning-note">У сімʼї немає іншої активної дитини з цим предметом.</div>}
            <div className="field"><label>Кількість занять</label><input className="input" type="number" min="0.5" max={transferable || undefined} step="0.5" value={transfer.lessonUnits} onChange={(event) => setTransfer((value) => ({ ...value, lessonUnits: event.target.value }))} required /></div>
            <div className="field"><label>Коментар</label><textarea className="input" value={note} onChange={(event) => setNote(event.target.value)} /></div>
            <button className="btn" disabled={busy || !transfer.toEnrollmentId || !familyTargets.length}>Передати заняття</button>
          </form>}
        </div>
      </aside>
    </div>}
  </div>;
}
