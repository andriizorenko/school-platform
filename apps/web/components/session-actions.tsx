"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { dateOnly, timeOnly } from "../lib/format";

export type SessionActionRole = "ADMIN" | "MANAGER" | "TEACHER" | "PARENT" | "STUDENT";

export type SessionActionDetail = {
  id: string;
  student: { id: string };
  enrollmentId?: string | null;
  sessionType: "FIRST" | "REGULAR";
  startsAt: string;
  capabilities: {
    canMark: boolean;
    canReschedule: boolean;
    canReportIncident: boolean;
    canAssignSubstitute: boolean;
  };
};

type Action = "mark" | "reschedule" | "substitute" | "student-no-show" | "teacher-late-cancellation" | null;

type FreeSlot = { startsAt: string; endsAt: string; date: string; time: string };
type FreeSlotsResponse = {
  sessionId: string;
  teacherId: string;
  durationMinutes: number;
  from: string;
  to: string;
  slots: FreeSlot[];
  canMoveToEnd: boolean;
};

type SubstituteCandidate = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone?: string | null;
  zoomUrl?: string | null;
  isPrimaryTeacher: boolean;
};
type SubstituteCandidatesResponse = {
  sessionId: string;
  startsAt: string;
  endsAt: string;
  candidates: SubstituteCandidate[];
};

type Props = {
  role: SessionActionRole;
  detail: SessionActionDetail;
  onSuccess: () => Promise<void> | void;
};

function RescheduleReasonFields({
  role,
  value,
  onChange,
}: {
  role: SessionActionRole;
  value: string;
  onChange: (value: string) => void;
}) {
  if (role === "PARENT") {
    return <input type="hidden" value="PARENT_REQUEST" readOnly />;
  }

  const options = role === "TEACHER"
    ? [
        ["TEACHER_TECHNICAL", "Технічна проблема / звʼязок"],
        ["TEACHER_PERSONAL", "Особиста причина"],
        ["OTHER", "Інша причина"],
      ]
    : [
        ["PARENT_REQUEST", "Запит батьків"],
        ["STUDENT_CANNOT_ATTEND", "Учень не може бути присутнім"],
        ["TEACHER_TECHNICAL", "Технічна проблема викладача"],
        ["TEACHER_PERSONAL", "Особиста причина викладача"],
        ["TEACHER_VACATION", "Відпустка викладача"],
        ["STUDENT_PAUSE", "Пауза / канікули учня"],
        ["SCHOOL_REASON", "Причина школи"],
        ["OTHER", "Інша причина"],
      ];

  return (
    <div className="field">
      <label>Причина</label>
      <select className="select" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, label]) => (
          <option key={optionValue} value={optionValue}>{label}</option>
        ))}
      </select>
    </div>
  );
}

export function SessionActions({ role, detail, onSuccess }: Props) {
  const [action, setAction] = useState<Action>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [topicTitle, setTopicTitle] = useState("");
  const [homeworkAssigned, setHomeworkAssigned] = useState<boolean | null>(null);
  const [strengths, setStrengths] = useState("");
  const [gaps, setGaps] = useState("");
  const [actionPlan, setActionPlan] = useState("");

  const [rescheduleReason, setRescheduleReason] = useState(
    role === "PARENT" ? "PARENT_REQUEST" : role === "TEACHER" ? "TEACHER_PERSONAL" : "PARENT_REQUEST",
  );
  const [rescheduleComment, setRescheduleComment] = useState("");
  const [slotDays, setSlotDays] = useState(14);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotData, setSlotData] = useState<FreeSlotsResponse | null>(null);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [incidentComment, setIncidentComment] = useState("");
  const [substitutesLoading, setSubstitutesLoading] = useState(false);
  const [substituteCandidates, setSubstituteCandidates] = useState<SubstituteCandidate[]>([]);
  const [selectedSubstitute, setSelectedSubstitute] = useState("");

  const journalHref = useMemo(() => {
    if (!detail.enrollmentId) return null;
    return `/${role.toLowerCase()}/students/${detail.student.id}`;
  }, [detail.enrollmentId, detail.student.id, role]);

  const slotGroups = useMemo(() => {
    const groups = new Map<string, FreeSlot[]>();
    for (const slot of slotData?.slots ?? []) {
      const list = groups.get(slot.date) ?? [];
      list.push(slot);
      groups.set(slot.date, list);
    }
    return [...groups.entries()];
  }, [slotData]);

  useEffect(() => {
    if (action !== "reschedule") return;
    setSlotsLoading(true);
    setError("");
    setSelectedSlot("");
    api<FreeSlotsResponse>(`/sessions/${detail.id}/free-slots?days=${slotDays}`)
      .then(setSlotData)
      .catch((exception: any) => {
        setSlotData(null);
        setError(exception?.message ?? "Не вдалося завантажити вільні години");
      })
      .finally(() => setSlotsLoading(false));
  }, [action, detail.id, slotDays]);

  useEffect(() => {
    if (action !== "substitute") return;
    setSubstitutesLoading(true);
    setError("");
    setSelectedSubstitute("");
    api<SubstituteCandidatesResponse>(`/sessions/${detail.id}/substitute-candidates`)
      .then((response) => setSubstituteCandidates(response.candidates ?? []))
      .catch((exception: any) => {
        setSubstituteCandidates([]);
        setError(exception?.message ?? "Не вдалося знайти викладачів на заміну");
      })
      .finally(() => setSubstitutesLoading(false));
  }, [action, detail.id]);

  function open(next: Action) {
    setError("");
    if (next === "reschedule") {
      setSlotDays(14);
      setSlotData(null);
      setSelectedSlot("");
    }
    if (next === "substitute") {
      setSubstituteCandidates([]);
      setSelectedSubstitute("");
    }
    setAction(next);
  }

  async function finish(task: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await task();
      await onSuccess();
    } catch (exception: any) {
      setError(exception?.message ?? "Не вдалося виконати дію");
    } finally {
      setBusy(false);
    }
  }

  async function submitMark(event: FormEvent) {
    event.preventDefault();

    if (detail.sessionType === "FIRST") {
      if (!strengths.trim() || !gaps.trim() || !actionPlan.trim()) return;
      await finish(() => api(`/sessions/${detail.id}/first-lesson/complete`, {
        method: "POST",
        body: JSON.stringify({
          strengths: strengths.trim(),
          gaps: gaps.trim(),
          actionPlan: actionPlan.trim(),
          visibleToStudent: true,
        }),
      }));
      return;
    }

    if (!topicTitle.trim() || homeworkAssigned === null) return;
    await finish(() => api(`/sessions/${detail.id}/mark`, {
      method: "POST",
      body: JSON.stringify({
        topicTitle: topicTitle.trim(),
        homeworkAssigned,
      }),
    }));
  }

  async function submitReschedule(event: FormEvent) {
    event.preventDefault();
    if (!selectedSlot) {
      setError("Оберіть вільну годину викладача");
      return;
    }

    await finish(() => api(`/sessions/${detail.id}/reschedule`, {
      method: "POST",
      body: JSON.stringify({
        startsAt: selectedSlot,
        reason: role === "PARENT" ? "PARENT_REQUEST" : rescheduleReason,
        mode: "FREE_SLOT",
        comment: rescheduleComment.trim() || undefined,
      }),
    }));
  }

  async function moveToEnd() {
    await finish(() => api(`/sessions/${detail.id}/reschedule`, {
      method: "POST",
      body: JSON.stringify({
        reason: role === "PARENT" ? "PARENT_REQUEST" : rescheduleReason,
        mode: "END_OF_PAID_SEQUENCE",
        comment: rescheduleComment.trim() || undefined,
      }),
    }));
  }

  async function assignSubstitute(event: FormEvent) {
    event.preventDefault();
    if (!selectedSubstitute) {
      setError("Оберіть викладача на заміну");
      return;
    }
    await finish(() => api(`/sessions/${detail.id}/substitute`, {
      method: "POST",
      body: JSON.stringify({ teacherId: selectedSubstitute }),
    }));
  }

  async function submitIncident(event: FormEvent, kind: "student-no-show" | "teacher-late-cancellation") {
    event.preventDefault();
    await finish(() => api(`/sessions/${detail.id}/incidents/${kind}`, {
      method: "POST",
      body: JSON.stringify({ comment: incidentComment.trim() || undefined }),
    }));
  }

  if (action === "mark") {
    return (
      <form className="stack session-action-form" onSubmit={submitMark}>
        <div className="row action-form-head">
          <button type="button" className="link-button" onClick={() => open(null)}>← Назад</button>
          <strong>{detail.sessionType === "FIRST" ? "Звіт після першого уроку" : "Відмітити урок"}</strong>
        </div>

        {detail.sessionType === "FIRST" ? (
          <>
            <div className="field"><label>Що учень памʼятає добре *</label><textarea className="textarea" rows={4} maxLength={4000} required value={strengths} onChange={(event) => setStrengths(event.target.value)} /></div>
            <div className="field"><label>Що потрібно повторити *</label><textarea className="textarea" rows={4} maxLength={4000} required value={gaps} onChange={(event) => setGaps(event.target.value)} /></div>
            <div className="field"><label>План подальшого навчання *</label><textarea className="textarea" rows={4} maxLength={4000} required value={actionPlan} onChange={(event) => setActionPlan(event.target.value)} /></div>
            <p className="muted form-note">Перший урок не можна завершити без цього звіту.</p>
          </>
        ) : (
          <>
            <div className="field"><label>Тема заняття *</label><input className="input" maxLength={300} required value={topicTitle} onChange={(event) => setTopicTitle(event.target.value)} placeholder="Наприклад: Квадратні рівняння" /></div>
            <fieldset className="choice-field">
              <legend>Домашнє завдання *</legend>
              <label className={`choice-card ${homeworkAssigned === true ? "selected" : ""}`}><input type="radio" name="homework" checked={homeworkAssigned === true} onChange={() => setHomeworkAssigned(true)} />Задано</label>
              <label className={`choice-card ${homeworkAssigned === false ? "selected" : ""}`}><input type="radio" name="homework" checked={homeworkAssigned === false} onChange={() => setHomeworkAssigned(false)} />Не задано</label>
            </fieldset>
          </>
        )}

        {error && <div className="error">{error}</div>}
        <button className="btn" disabled={busy}>{busy ? "Зберігаємо…" : detail.sessionType === "FIRST" ? "Завершити перший урок" : "Зберегти урок"}</button>
      </form>
    );
  }

  if (action === "reschedule") {
    return (
      <form className="stack session-action-form" onSubmit={submitReschedule}>
        <div className="row action-form-head">
          <button type="button" className="link-button" onClick={() => open(null)}>← Назад</button>
          <strong>Перенести заняття</strong>
        </div>

        <RescheduleReasonFields role={role} value={rescheduleReason} onChange={setRescheduleReason} />

        <div className="field">
          <label>Вільні години цього викладача</label>
          {slotsLoading ? <div className="empty compact-empty">Шукаємо вільні години…</div> : slotGroups.length ? (
            <div className="free-slot-list">
              {slotGroups.map(([date, slots]) => (
                <div className="free-slot-day" key={date}>
                  <strong>{dateOnly(slots[0].startsAt)}</strong>
                  <div className="free-slot-times">
                    {slots.map(slot => <button key={slot.startsAt} type="button" className={`slot-button ${selectedSlot === slot.startsAt ? "selected" : ""}`} onClick={()=>setSelectedSlot(slot.startsAt)}>{timeOnly(slot.startsAt)}</button>)}
                  </div>
                </div>
              ))}
            </div>
          ) : <div className="notice-card">На вибраний період вільних годин не знайдено.</div>}
        </div>

        {slotDays === 14 && <button type="button" className="btn secondary" disabled={slotsLoading} onClick={()=>setSlotDays(28)}>Показати вільні години на 28 днів</button>}

        <div className="field"><label>Коментар</label><textarea className="textarea" rows={3} maxLength={500} value={rescheduleComment} onChange={(event) => setRescheduleComment(event.target.value)} placeholder="Необовʼязково" /></div>
        <p className="muted form-note">Це разове перенесення. Регулярний графік учня не змінюється.</p>
        {role === "PARENT" && <p className="muted form-note">Батьки бачать лише вільні години цього ж викладача. Перенесення доступне не пізніше ніж за 2 години до поточного початку.</p>}
        {error && <div className="error">{error}</div>}
        <button className="btn" disabled={busy || !selectedSlot}>{busy ? "Переносимо…" : "Перенести на вибрану годину"}</button>
        {role !== "PARENT" && slotData?.canMoveToEnd && <button type="button" className="btn secondary" disabled={busy} onClick={moveToEnd}>Перенести в кінець абонементу</button>}
      </form>
    );
  }

  if (action === "substitute") {
    return (
      <form className="stack session-action-form" onSubmit={assignSubstitute}>
        <div className="row action-form-head">
          <button type="button" className="link-button" onClick={() => open(null)}>← Назад</button>
          <strong>Призначити викладача на заміну</strong>
        </div>
        <p className="muted form-note">Показані лише викладачі цього предмета, які вільні протягом усього заняття.</p>
        {substitutesLoading ? <div className="empty compact-empty">Шукаємо доступних викладачів…</div> : substituteCandidates.length ? (
          <div className="stack">
            {substituteCandidates.map((candidate) => (
              <label key={candidate.id} className={`choice-card ${selectedSubstitute === candidate.id ? "selected" : ""}`}>
                <input type="radio" name="substitute" checked={selectedSubstitute === candidate.id} onChange={() => setSelectedSubstitute(candidate.id)} />
                <span><strong>{candidate.fullName}</strong>{candidate.isPrimaryTeacher && <span className="badge" style={{marginLeft:8}}>Основний</span>}{candidate.phone && <span className="muted" style={{display:"block",fontSize:12}}>{candidate.phone}</span>}</span>
              </label>
            ))}
          </div>
        ) : <div className="notice-card">На цей час доступних викладачів на заміну не знайдено.</div>}
        {error && <div className="error">{error}</div>}
        <button className="btn" disabled={busy || substitutesLoading || !selectedSubstitute}>{busy ? "Призначаємо…" : "Призначити заміну"}</button>
      </form>
    );
  }

  if (action === "student-no-show" || action === "teacher-late-cancellation") {
    const studentNoShow = action === "student-no-show";
    return (
      <form className="stack session-action-form" onSubmit={(event) => submitIncident(event, action)}>
        <div className="row action-form-head"><button type="button" className="link-button" onClick={() => open(null)}>← Назад</button><strong>{studentNoShow ? "Учень не прийшов" : "Пізнє скасування викладача"}</strong></div>
        <div className="notice-card">{studentNoShow ? "Система застосує правило першого/другого no-show для цього предмета." : "Система застосує правило порушень викладача для цієї пари викладач–учень."}</div>
        <div className="field"><label>Коментар</label><textarea className="textarea" rows={3} maxLength={500} value={incidentComment} onChange={(event) => setIncidentComment(event.target.value)} placeholder="Обставини події — необовʼязково" /></div>
        {error && <div className="error">{error}</div>}
        <button className="btn danger" disabled={busy}>{busy ? "Фіксуємо…" : "Підтвердити"}</button>
      </form>
    );
  }

  return (
    <div className="stack session-actions">
      {detail.capabilities.canMark && <button disabled={busy} className="btn" onClick={() => open("mark")}>Відмітити урок</button>}
      {detail.capabilities.canReschedule && <button disabled={busy} className="btn secondary" onClick={() => open("reschedule")}>Перенести</button>}
      {detail.capabilities.canAssignSubstitute && <button disabled={busy} className="btn secondary" onClick={() => open("substitute")}>Призначити заміну</button>}
      {detail.capabilities.canReportIncident && role === "TEACHER" && <><button disabled={busy} className="btn secondary" onClick={() => open("student-no-show")}>Учень не прийшов</button><button disabled={busy} className="btn secondary" onClick={() => open("teacher-late-cancellation")}>Не можу провести (пізнє скасування)</button></>}
      {journalHref && <Link className="btn secondary" href={journalHref}>Журнал учня</Link>}
    </div>
  );
}
