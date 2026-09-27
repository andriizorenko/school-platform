"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { dateOnly, timeOnly } from "../lib/format";

export type SessionActionRole = "ADMIN" | "MANAGER" | "TEACHER" | "PARENT" | "STUDENT";

export type SessionActionDetail = {
  id: string;
  student: { id: string };
  subject: { id: string };
  enrollmentId?: string | null;
  sessionType: "FIRST" | "REGULAR";
  fundingStatus: "PAID" | "BOOKED";
  startsAt: string;
  status: string;
  needsReport?: boolean;
  lateNoticeCutoffMinutes: number;
  studentNoShowWaitMinutes: number;
  currentIncident?: {
    type: "STUDENT_NO_SHOW" | "TEACHER_LATE_CANCELLATION";
    outcome?: "RESCHEDULE_REQUIRED_NO_CHARGE" | "CHARGED_NO_SHOW" | "COMPENSATION_GRANTED" | null;
  } | null;
  capabilities: {
    canShowMark: boolean;
    canMark: boolean;
    canReschedule: boolean;
    canRescheduleToPast: boolean;
    canUndoOutcome: boolean;
    canReportIncident: boolean;
    canReportStudentNoShow: boolean;
    canReportTeacherLateCancellation: boolean;
    canAssignSubstitute: boolean;
  };
};

type Action = "mark" | "first-payment" | "reschedule" | "substitute" | "undo-outcome" | null;
type RescheduleParty = "STUDENT" | "TEACHER";
type RescheduleSituation = "ADVANCE" | "LATE" | "TECHNICAL";
type RescheduleStep = "context" | "slot";

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
  onReportReminder?: (studentId: string) => void;
};

export function SessionActions({ role, detail, onSuccess, onReportReminder }: Props) {
  const actionFormRef = useRef<HTMLFormElement | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [topicTitle, setTopicTitle] = useState("");
  const [homeworkAssigned, setHomeworkAssigned] = useState<boolean | null>(null);
  const [strengths, setStrengths] = useState("");
  const [gaps, setGaps] = useState("");
  const [actionPlan, setActionPlan] = useState("");

  const [rescheduleReason, setRescheduleReason] = useState("PARENT_REQUEST");
  const [rescheduleStep, setRescheduleStep] = useState<RescheduleStep>("context");
  const [rescheduleParty, setRescheduleParty] = useState<RescheduleParty | "">("");
  const [rescheduleSituation, setRescheduleSituation] = useState<RescheduleSituation | "">("");
  const [rescheduleComment, setRescheduleComment] = useState("");
  const [slotDays, setSlotDays] = useState(14);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotData, setSlotData] = useState<FreeSlotsResponse | null>(null);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [manualStartsAt, setManualStartsAt] = useState("");
  const [rescheduleAfterIncident, setRescheduleAfterIncident] = useState<null | "student-no-show" | "teacher-late-cancellation">(null);
  const [teacherCompensationGranted, setTeacherCompensationGranted] = useState(false);
  const [firstLessonAmount, setFirstLessonAmount] = useState("");
  const [firstLessonPaymentMethod, setFirstLessonPaymentMethod] = useState("BANK_TRANSFER");
  const [firstLessonPriceLoading, setFirstLessonPriceLoading] = useState(false);
  const [substitutesLoading, setSubstitutesLoading] = useState(false);
  const [substituteCandidates, setSubstituteCandidates] = useState<SubstituteCandidate[]>([]);
  const [selectedSubstitute, setSelectedSubstitute] = useState("");
  const [undoReason, setUndoReason] = useState("");

  const markDisabledText = !detail.capabilities.canShowMark || detail.capabilities.canMark
    ? ""
    : detail.fundingStatus !== "PAID"
      ? "Спочатку потрібно зафіксувати оплату."
      : Date.now() < new Date(detail.startsAt).getTime()
        ? `Можна відмітити після ${timeOnly(detail.startsAt)}.`
        : "Вікно відмітки для викладача завершилось.";

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
    const frame = window.requestAnimationFrame(() => {
      actionFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [action, rescheduleStep]);

  useEffect(() => {
    if (action !== "reschedule" || rescheduleStep !== "slot") return;
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
  }, [action, detail.id, rescheduleStep, slotDays]);

  useEffect(() => {
    if (action !== "first-payment") return;
    setFirstLessonPriceLoading(true);
    setError("");
    api<any>(`/subjects/${detail.subject.id}/prices/current`)
      .then((price) => setFirstLessonAmount((Number(price.firstLessonPriceMinor ?? 0) / 100).toFixed(2)))
      .catch((exception: any) => {
        setFirstLessonAmount("");
        setError(exception?.message ?? "Не вдалося завантажити ціну першого уроку");
      })
      .finally(() => setFirstLessonPriceLoading(false));
  }, [action, detail.subject.id]);

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
    if (next !== "reschedule") {
      setRescheduleAfterIncident(null);
      setTeacherCompensationGranted(false);
    }
    if (next === "reschedule") {
      setSlotDays(14);
      setSlotData(null);
      setSelectedSlot("");
      setManualStartsAt("");
      setRescheduleComment("");

      if (detail.currentIncident?.type === "STUDENT_NO_SHOW") {
        setRescheduleParty("STUDENT");
        setRescheduleSituation("LATE");
        setRescheduleReason("STUDENT_LATE_NO_NOTICE");
        setRescheduleAfterIncident("student-no-show");
        setRescheduleStep("slot");
      } else if (detail.currentIncident?.type === "TEACHER_LATE_CANCELLATION") {
        setRescheduleParty("TEACHER");
        setRescheduleSituation("LATE");
        setRescheduleReason("TEACHER_LATE_CANCELLATION");
        setTeacherCompensationGranted(detail.currentIncident.outcome === "COMPENSATION_GRANTED");
        setRescheduleAfterIncident("teacher-late-cancellation");
        setRescheduleStep("slot");
      } else if (role === "PARENT") {
        setRescheduleParty("STUDENT");
        setRescheduleSituation("ADVANCE");
        setRescheduleReason("PARENT_REQUEST");
        setRescheduleAfterIncident(null);
        setTeacherCompensationGranted(false);
        setRescheduleStep("slot");
      } else {
        setRescheduleParty("");
        setRescheduleSituation("");
        setRescheduleReason("PARENT_REQUEST");
        setRescheduleAfterIncident(null);
        setTeacherCompensationGranted(false);
        setRescheduleStep("context");
      }
    }
    if (next === "substitute") {
      setSubstituteCandidates([]);
      setSelectedSubstitute("");
    }
    if (next === "undo-outcome") {
      setUndoReason("");
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

    setBusy(true);
    setError("");
    try {
      await api(`/sessions/${detail.id}/mark`, {
        method: "POST",
        body: JSON.stringify({
          topicTitle: topicTitle.trim(),
          homeworkAssigned,
        }),
      });

      if (role === "TEACHER" && detail.needsReport) {
        onReportReminder?.(detail.student.id);
      }
      await onSuccess();
    } catch (exception: any) {
      setError(exception?.message ?? "Не вдалося виконати дію");
    } finally {
      setBusy(false);
    }
  }

  async function submitFirstPayment(event: FormEvent) {
    event.preventDefault();
    const amount = Number(firstLessonAmount.replace(",", "."));
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Вкажіть коректну суму оплати.");
      return;
    }
    await finish(() => api(`/sessions/${detail.id}/first-lesson/payment`, {
      method: "POST",
      body: JSON.stringify({
        amountMinor: Math.round(amount * 100),
        paymentMethod: firstLessonPaymentMethod,
      }),
    }));
  }

  const lateNoticeLabel = (() => {
    if (detail.lateNoticeCutoffMinutes % 60 !== 0) return `${detail.lateNoticeCutoffMinutes} хв`;
    const hours = detail.lateNoticeCutoffMinutes / 60;
    const mod10 = hours % 10;
    const mod100 = hours % 100;
    const unit = mod10 === 1 && mod100 !== 11
      ? "годину"
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? "години"
        : "годин";
    return `${hours} ${unit}`;
  })();

  const rescheduleParties: Array<{ value: RescheduleParty; label: string }> = [
    { value: "STUDENT", label: "Учень" },
    { value: "TEACHER", label: "Викладач" },
  ];

  const rescheduleSituations: Array<{ value: RescheduleSituation; label: string; note: string; disabled?: boolean }> =
    rescheduleParty === "STUDENT"
      ? [
          { value: "ADVANCE", label: "Завчасно попередили", note: `Не пізніше ніж за ${lateNoticeLabel}` },
          { value: "LATE", label: "Без завчасного попередження", note: `Пізніше ніж за ${lateNoticeLabel} або не попередили`, disabled: !detail.capabilities.canReportIncident },
          { value: "TECHNICAL", label: "Технічні / форс-мажорні", note: "Світло, звʼязок, тривога, обстріл тощо" },
        ]
      : rescheduleParty === "TEACHER"
        ? [
            { value: "ADVANCE", label: "Завчасно попередив", note: `Не пізніше ніж за ${lateNoticeLabel}` },
            { value: "LATE", label: "Пізнє скасування", note: `Пізніше ніж за ${lateNoticeLabel}`, disabled: !detail.capabilities.canReportIncident },
            { value: "TECHNICAL", label: "Технічні / форс-мажорні", note: "Світло, звʼязок, тривога, обстріл тощо" },
          ]
        : [];

  function mappedRescheduleReason() {
    if (rescheduleParty === "STUDENT") {
      if (rescheduleSituation === "ADVANCE") return "STUDENT_ADVANCE_NOTICE";
      if (rescheduleSituation === "LATE") return "STUDENT_LATE_NO_NOTICE";
      if (rescheduleSituation === "TECHNICAL") return "STUDENT_TECHNICAL";
    }
    if (rescheduleParty === "TEACHER") {
      if (rescheduleSituation === "ADVANCE") return "TEACHER_ADVANCE_NOTICE";
      if (rescheduleSituation === "LATE") return "TEACHER_LATE_CANCELLATION";
      if (rescheduleSituation === "TECHNICAL") return "TEACHER_TECHNICAL";
    }
    return "";
  }

  async function continueRescheduleContext() {
    const reason = mappedRescheduleReason();
    if (!rescheduleParty || !rescheduleSituation || !reason) {
      setError("Оберіть, хто переносить урок, і причину.");
      return;
    }

    setRescheduleReason(reason);

    if (rescheduleSituation !== "LATE") {
      setRescheduleStep("slot");
      return;
    }

    if (!detail.capabilities.canReportIncident) {
      setError(`Пізню відміну можна фіксувати не раніше ніж за ${lateNoticeLabel} до уроку. Якщо повідомили раніше — оберіть «Завчасно попередили».`);
      return;
    }

    const kind = rescheduleParty === "STUDENT" ? "student-no-show" : "teacher-late-cancellation";
    setBusy(true);
    setError("");
    try {
      const result = await api<any>(`/sessions/${detail.id}/incidents/${kind}`, {
        method: "POST",
        body: JSON.stringify({ comment: rescheduleComment.trim() || undefined }),
      });

      if (result?.requiresReschedule) {
        if (kind === "student-no-show") {
          setRescheduleAfterIncident("student-no-show");
        } else {
          setTeacherCompensationGranted(Boolean(result?.compensationGranted));
          setRescheduleAfterIncident("teacher-late-cancellation");
        }
        setRescheduleStep("slot");
        return;
      }

      await onSuccess();
    } catch (exception: any) {
      setError(exception?.message ?? "Не вдалося зафіксувати причину перенесення");
    } finally {
      setBusy(false);
    }
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

  async function moveToPast() {
    if (!manualStartsAt) { setError("Вкажіть дату та час у минулому."); return; }
    if (!rescheduleComment.trim()) { setError("Для перенесення в минуле обовʼязково вкажіть причину в коментарі."); return; }
    const startsAt = new Date(manualStartsAt);
    if (Number.isNaN(startsAt.getTime())) { setError("Вкажіть коректну дату та час."); return; }

    await finish(() => api(`/sessions/${detail.id}/reschedule`, {
      method: "POST",
      body: JSON.stringify({
        startsAt: startsAt.toISOString(),
        reason: rescheduleReason,
        mode: "MANUAL",
        comment: rescheduleComment.trim(),
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


  async function undoOutcome(event: FormEvent) {
    event.preventDefault();
    if (!undoReason.trim()) {
      setError("Вкажіть причину скасування відмітки.");
      return;
    }
    await finish(() => api(`/sessions/${detail.id}/outcome/undo`, {
      method: "POST",
      body: JSON.stringify({ reason: undoReason.trim() }),
    }));
  }

  const undoOutcomeLabel = detail.status === "COMPLETED"
    ? (detail.sessionType === "FIRST" ? "Скасувати проведення першого уроку" : "Скасувати проведення уроку")
    : detail.status === "CHARGED_NO_SHOW"
      ? "Скасувати пропуск зі списанням"
      : detail.currentIncident?.type === "STUDENT_NO_SHOW"
        ? "Скасувати відмітку пропуску"
        : detail.currentIncident?.type === "TEACHER_LATE_CANCELLATION"
          ? "Скасувати пізнє скасування"
          : "Скасувати відмітку";

  const undoOutcomeExplanation = detail.status === "COMPLETED"
    ? "Урок знову стане запланованим. Система поверне списані заняття та прибере неоплачене нарахування викладачу."
    : detail.status === "CHARGED_NO_SHOW"
      ? "Пропуск буде скасовано: урок знову стане запланованим, заняття повернеться на баланс, а неоплачене нарахування викладачу буде прибрано."
      : detail.currentIncident?.type === "STUDENT_NO_SHOW"
        ? "Відмітка пропуску буде прибрана, а лічильник пропусків учня перерахується."
        : "Відмітка пізнього скасування буде прибрана, а повʼязані правила та компенсація будуть перераховані.";

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

  if (action === "first-payment") {
    return (
      <form className="stack session-action-form" onSubmit={submitFirstPayment}>
        <div className="row action-form-head">
          <button type="button" className="link-button" onClick={() => open(null)}>← Назад</button>
          <strong>Оплата першого уроку</strong>
        </div>
        <p className="muted form-note">Оплату потрібно зафіксувати до запланованого початку першого уроку.</p>
        <div className="field"><label>Отримано, ₴</label><input className="input" type="number" min="0" step="0.01" required disabled={firstLessonPriceLoading} value={firstLessonAmount} onChange={(event) => setFirstLessonAmount(event.target.value)} /></div>
        <div className="field"><label>Спосіб оплати</label><select className="select" value={firstLessonPaymentMethod} onChange={(event) => setFirstLessonPaymentMethod(event.target.value)}><option value="BANK_TRANSFER">Переказ</option><option value="CARD">Картка</option><option value="CASH">Готівка</option><option value="OTHER">Інше</option></select></div>
        {error && <div className="error">{error}</div>}
        <button className="btn" disabled={busy || firstLessonPriceLoading || firstLessonAmount === ""}>{busy ? "Зберігаємо…" : "Зафіксувати оплату"}</button>
      </form>
    );
  }

  if (action === "reschedule") {
    return (
      <form
        ref={actionFormRef}
        className="stack session-action-form"
        onSubmit={rescheduleStep === "slot"
          ? submitReschedule
          : (event) => { event.preventDefault(); void continueRescheduleContext(); }}
      >
        <div className="row action-form-head">
          <button type="button" className="link-button" onClick={() => open(null)}>← Назад</button>
          <strong>{rescheduleAfterIncident === "student-no-show" ? "Домовитись про відпрацювання" : rescheduleAfterIncident === "teacher-late-cancellation" ? "Перенести після скасування" : "Перенести урок"}</strong>
        </div>

        {rescheduleStep === "context" ? (
          <>
            <fieldset className="choice-field reschedule-party-field">
              <legend>Хто переносить урок?</legend>
              {rescheduleParties.map((party) => (
                <label key={party.value} className={`choice-card ${rescheduleParty === party.value ? "selected" : ""}`}>
                  <input
                    type="radio"
                    name="reschedule-party"
                    checked={rescheduleParty === party.value}
                    onChange={() => {
                      setRescheduleParty(party.value);
                      setRescheduleSituation("");
                      setError("");
                    }}
                  />
                  <strong>{party.label}</strong>
                </label>
              ))}
            </fieldset>

            {rescheduleParty && <fieldset className="choice-field reschedule-situation-field">
              <legend>Що сталося?</legend>
              {rescheduleSituations.map((situation) => (
                <label key={situation.value} className={`choice-card ${rescheduleSituation === situation.value ? "selected" : ""} ${situation.disabled ? "disabled" : ""}`}>
                  <input
                    type="radio"
                    name="reschedule-situation"
                    disabled={situation.disabled}
                    checked={rescheduleSituation === situation.value}
                    onChange={() => {
                      setRescheduleSituation(situation.value);
                      setError("");
                    }}
                  />
                  <span><strong>{situation.label}</strong><span className="muted" style={{display:"block",fontSize:12,marginTop:3}}>{situation.note}</span></span>
                </label>
              ))}
            </fieldset>}

            {rescheduleParty && (rescheduleParty === "STUDENT" || rescheduleParty === "TEACHER") && !detail.capabilities.canReportIncident && (
              <div className="muted form-note">Пізня відміна стане доступною лише всередині вікна {lateNoticeLabel} до уроку. Завчасне або форс-мажорне перенесення можна оформити зараз.</div>
            )}

            <div className="field">
              <label>Коментар</label>
              <textarea className="textarea" rows={3} maxLength={500} value={rescheduleComment} onChange={(event) => setRescheduleComment(event.target.value)} placeholder="Деталі — необовʼязково" />
            </div>

            {error && <div className="error">{error}</div>}
            <button className="btn" disabled={busy || !rescheduleParty || !rescheduleSituation}>{busy ? "Перевіряємо…" : "Продовжити"}</button>
          </>
        ) : (
          <>
            {rescheduleAfterIncident === "student-no-show" && <div className="notice-card"><strong>Пропуск без завчасного попередження зафіксовано.</strong><div className="muted" style={{marginTop:6}}>Для першого strike заняття не списується. Оберіть відпрацювання або перенесіть його в кінець абонементу.</div></div>}
            {rescheduleAfterIncident === "teacher-late-cancellation" && <div className="notice-card"><strong>{teacherCompensationGranted ? "Повторне пізнє скасування зафіксовано. Учню нараховано компенсаційне заняття." : "Пізнє скасування викладача зафіксовано."}</strong><div className="muted" style={{marginTop:6}}>Оберіть нову вільну годину або перенесіть заняття в кінець абонементу.</div></div>}

            {!rescheduleAfterIncident && role !== "PARENT" && (
              <div className="notice-card">
                <strong>{rescheduleParty === "STUDENT" ? "Учень" : "Викладач"} · {rescheduleSituations.find((item) => item.value === rescheduleSituation)?.label ?? "Перенесення"}</strong>
                <div className="muted" style={{marginTop:6}}>Якщо причина обрана помилково, поверніться назад і змініть її до підтвердження перенесення.</div>
                <button type="button" className="link-button" style={{marginTop:8}} onClick={() => { setRescheduleStep("context"); setSelectedSlot(""); setSlotData(null); }}>← Змінити причину</button>
              </div>
            )}

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

            <div className="field"><label>Коментар</label><textarea className="textarea" rows={3} maxLength={500} value={rescheduleComment} onChange={(event) => setRescheduleComment(event.target.value)} placeholder={detail.capabilities.canRescheduleToPast ? "Для перенесення в минуле — обовʼязково" : "Необовʼязково"} /></div>

            {detail.capabilities.canRescheduleToPast && !rescheduleAfterIncident && (
              <div className="notice-card stack">
                <div><strong>Адміністративне перенесення в минуле</strong><div className="muted" style={{marginTop:6}}>Для виправлення історичної дати уроку. Увесь урок має вже завершитися, а дія фіксується в аудиті.</div></div>
                <div className="field"><label>Нова дата й час початку</label><input className="input" type="datetime-local" value={manualStartsAt} onChange={(event)=>setManualStartsAt(event.target.value)} /></div>
                <button type="button" className="btn secondary" disabled={busy || !manualStartsAt || !rescheduleComment.trim()} onClick={()=>void moveToPast()}>{busy ? "Переносимо…" : "Перенести в минуле"}</button>
              </div>
            )}

            <p className="muted form-note">Це разове перенесення. Регулярний графік учня не змінюється.</p>
            {role === "PARENT" && <p className="muted form-note">Батьки бачать лише вільні години цього ж викладача. Перенесення доступне не пізніше ніж за 2 години до поточного початку.</p>}
            {error && <div className="error">{error}</div>}
            <button className="btn" disabled={busy || !selectedSlot}>{busy ? "Переносимо…" : rescheduleAfterIncident === "student-no-show" ? "Відпрацювати у вибрану годину" : "Перенести на вибрану годину"}</button>
            {role !== "PARENT" && slotData?.canMoveToEnd && <button type="button" className="btn secondary" disabled={busy} onClick={moveToEnd}>{rescheduleAfterIncident === "student-no-show" ? "Додати відпрацювання в кінець абонементу" : "Перенести в кінець абонементу"}</button>}
          </>
        )}
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

  if (action === "undo-outcome") {
    return (
      <form className="stack session-action-form" onSubmit={undoOutcome}>
        <div className="row action-form-head">
          <button type="button" className="link-button" onClick={() => open(null)}>← Назад</button>
          <strong>{undoOutcomeLabel}</strong>
        </div>
        <div className="notice-card">
          <strong>Це коригувальна дія.</strong>
          <div className="muted" style={{marginTop:6}}>{undoOutcomeExplanation}</div>
          <div className="muted" style={{marginTop:6}}>Якщо нарахування вже потрапило у зарплатний період або повʼязана компенсація вже використана, система не дозволить скасування.</div>
        </div>
        <div className="field">
          <label>Причина скасування *</label>
          <textarea
            className="textarea"
            rows={3}
            maxLength={500}
            required
            value={undoReason}
            onChange={(event) => setUndoReason(event.target.value)}
            placeholder="Наприклад: урок помилково відмічено як проведений"
          />
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn danger" disabled={busy || undoReason.trim().length < 3}>
          {busy ? "Скасовуємо…" : undoOutcomeLabel}
        </button>
      </form>
    );
  }

  return (
    <div className="stack session-actions">
      {detail.sessionType === "FIRST" && detail.fundingStatus === "BOOKED" && (role === "MANAGER" || role === "ADMIN") && <button disabled={busy} className="btn" onClick={() => open("first-payment")}>Зафіксувати оплату</button>}
      {detail.capabilities.canShowMark && <>
        <button disabled={busy || !detail.capabilities.canMark} className="btn" onClick={() => open("mark")}>Відмітити урок</button>
        {!detail.capabilities.canMark && markDisabledText && <div className="muted form-note">{markDisabledText}</div>}
      </>}
      {detail.capabilities.canReschedule && <button disabled={busy} className="btn secondary" onClick={() => open("reschedule")}>Перенести</button>}
      {detail.capabilities.canAssignSubstitute && <button disabled={busy} className="btn secondary" onClick={() => open("substitute")}>Призначити заміну</button>}
      {detail.capabilities.canUndoOutcome && <button disabled={busy} className="btn secondary danger-outline" onClick={() => open("undo-outcome")}>{undoOutcomeLabel}</button>}
      {journalHref && <Link className="btn secondary" href={journalHref}>Журнал учня</Link>}
    </div>
  );
}
