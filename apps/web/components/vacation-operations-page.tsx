"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { dateTime } from "../lib/format";
import { PlatformShell } from "./platform-shell";

type VacationStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
type VacationSummary = {
  id: string;
  teacherId: string;
  teacherName: string;
  startsOn: string;
  endsOn: string;
  comment?: string | null;
  status: VacationStatus;
  unresolvedLessons: number;
};
type VacationLesson = {
  id: string;
  enrollmentId?: string | null;
  student: { id: string; firstName: string; lastName: string; gradeLevel?: number | null };
  subject: { id: string; name: string };
  sessionType: "FIRST" | "REGULAR";
  fundingStatus: "PAID" | "BOOKED";
  startsAt: string;
  endsAt: string;
  canMoveToEnd: boolean;
};
type VacationImpact = {
  vacation: VacationSummary;
  unresolvedLessons: VacationLesson[];
};
type SubstituteCandidate = {
  id: string;
  fullName: string;
  phone?: string | null;
};

type Role = "ADMIN" | "MANAGER";

const statusLabel: Record<VacationStatus, string> = {
  PENDING: "Очікує погодження",
  APPROVED: "Погоджено",
  REJECTED: "Відхилено",
  CANCELLED: "Скасовано",
};

export function VacationOperationsPage({ role }: { role: Role }) {
  const [items, setItems] = useState<VacationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VacationImpact | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [candidateSessionId, setCandidateSessionId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<SubstituteCandidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState("");
  const [candidatesLoading, setCandidatesLoading] = useState(false);

  const allowedRoles = role === "ADMIN" ? ["ADMIN", "SUPPORT_MANAGER"] : ["MANAGER"];

  async function loadList() {
    setError("");
    setLoading(true);
    try {
      const data = await api<VacationSummary[]>("/teachers/vacations?status=OPEN");
      setItems(data);
      if (selectedId && !data.some((item) => item.id === selectedId)) {
        setSelectedId(null);
        setDetail(null);
      }
    } catch (exception: any) {
      setError(exception?.message ?? "Не вдалося завантажити запити на відпустку");
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id: string) {
    setSelectedId(id);
    setDetailLoading(true);
    setError("");
    setCandidateSessionId(null);
    setCandidates([]);
    setSelectedCandidate("");
    try {
      const data = await api<VacationImpact>(`/teachers/vacations/${id}`);
      setDetail(data);
    } catch (exception: any) {
      setError(exception?.message ?? "Не вдалося завантажити заняття відпустки");
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => { void loadList(); }, []);

  async function review(status: "APPROVED" | "REJECTED") {
    if (!selectedId) return;
    setBusyKey(`review:${status}`);
    setError(""); setMessage("");
    try {
      await api(`/teachers/vacations/${selectedId}/review`, {
        method: "PATCH",
        body: JSON.stringify({ status, comment: reviewComment.trim() || undefined }),
      });
      setMessage(status === "APPROVED" ? "Відпустку погоджено. Тепер опрацюйте заняття нижче." : "Запит відхилено.");
      setReviewComment("");
      await loadList();
      if (status === "APPROVED") await loadDetail(selectedId);
      else { setSelectedId(null); setDetail(null); }
    } catch (exception: any) {
      setError(exception?.message ?? "Не вдалося опрацювати запит");
    } finally {
      setBusyKey("");
    }
  }

  async function findSubstitutes(sessionId: string) {
    setCandidateSessionId(sessionId);
    setSelectedCandidate("");
    setCandidates([]);
    setCandidatesLoading(true);
    setError("");
    try {
      const response = await api<{ candidates: SubstituteCandidate[] }>(`/sessions/${sessionId}/substitute-candidates`);
      setCandidates(response.candidates ?? []);
    } catch (exception: any) {
      setError(exception?.message ?? "Не вдалося знайти заміну");
    } finally {
      setCandidatesLoading(false);
    }
  }

  async function assignSubstitute(sessionId: string) {
    if (!selectedCandidate || !selectedId) return;
    setBusyKey(`sub:${sessionId}`);
    setError(""); setMessage("");
    try {
      await api(`/sessions/${sessionId}/substitute`, {
        method: "POST",
        body: JSON.stringify({ teacherId: selectedCandidate }),
      });
      setMessage("Викладача на заміну призначено.");
      setCandidateSessionId(null); setCandidates([]); setSelectedCandidate("");
      await Promise.all([loadList(), loadDetail(selectedId)]);
    } catch (exception: any) {
      setError(exception?.message ?? "Не вдалося призначити заміну");
    } finally {
      setBusyKey("");
    }
  }

  async function moveToEnd(sessionId: string) {
    if (!selectedId) return;
    setBusyKey(`move:${sessionId}`);
    setError(""); setMessage("");
    try {
      await api(`/sessions/${sessionId}/reschedule`, {
        method: "POST",
        body: JSON.stringify({ mode: "END_OF_PAID_SEQUENCE", reason: "TEACHER_VACATION" }),
      });
      setMessage("Заняття перенесено в кінець абонементу.");
      await Promise.all([loadList(), loadDetail(selectedId)]);
    } catch (exception: any) {
      setError(exception?.message ?? "Не вдалося перенести заняття");
    } finally {
      setBusyKey("");
    }
  }

  const selectedSummary = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);

  return (
    <PlatformShell allowedRoles={allowedRoles}>
      <div className="page-head">
        <div>
          <h1>Відпустки викладачів</h1>
          <p className="muted">Погодження запитів і опрацювання кожного заняття, якого торкається відпустка.</p>
        </div>
      </div>

      {error && <div className="error" style={{marginBottom:12}}>{error}</div>}
      {message && <div className="success" style={{marginBottom:12}}>{message}</div>}

      <div className="vacation-ops-layout">
        <section className="stack">
          {loading ? <div className="card empty">Завантаження…</div> : items.length ? items.map((item) => (
            <button key={item.id} className={`card vacation-request-card ${selectedId === item.id ? "selected" : ""}`} onClick={() => void loadDetail(item.id)}>
              <div className="row" style={{justifyContent:"space-between"}}>
                <strong>{item.teacherName}</strong>
                <span className={`badge ${item.status === "APPROVED" ? "paid" : "booked"}`}>{statusLabel[item.status]}</span>
              </div>
              <div style={{marginTop:8}}>{item.startsOn} — {item.endsOn}</div>
              <div className="muted" style={{marginTop:6}}>Потребують рішення: {item.unresolvedLessons}</div>
              {item.comment && <div className="muted" style={{marginTop:6,fontSize:13}}>{item.comment}</div>}
            </button>
          )) : <div className="card empty">Немає активних запитів на відпустку.</div>}
        </section>

        <section>
          {!selectedId ? <div className="card empty">Оберіть запит ліворуч.</div> : detailLoading ? <div className="card empty">Завантаження занять…</div> : detail ? (
            <div className="stack">
              <div className="card">
                <div className="row" style={{justifyContent:"space-between"}}><div><h2>{detail.vacation.teacherName}</h2><div>{detail.vacation.startsOn} — {detail.vacation.endsOn}</div></div><span className={`badge ${detail.vacation.status === "APPROVED" ? "paid" : "booked"}`}>{statusLabel[detail.vacation.status]}</span></div>
                {detail.vacation.comment && <p className="muted" style={{marginTop:10}}>{detail.vacation.comment}</p>}
                {detail.vacation.status === "PENDING" && <div className="stack" style={{marginTop:16}}>
                  <div className="field"><label>Коментар до рішення</label><textarea className="textarea" rows={3} value={reviewComment} onChange={(event)=>setReviewComment(event.target.value)} placeholder="Необовʼязково" /></div>
                  <div className="row"><button className="btn" disabled={Boolean(busyKey)} onClick={()=>void review("APPROVED")}>Погодити</button><button className="btn danger" disabled={Boolean(busyKey)} onClick={()=>void review("REJECTED")}>Відхилити</button></div>
                </div>}
              </div>

              {detail.vacation.status === "APPROVED" && <>
                <div className="row" style={{justifyContent:"space-between"}}><h2 style={{margin:0}}>Заняття, які треба опрацювати</h2><span className="badge booked">{detail.unresolvedLessons.length}</span></div>
                {detail.unresolvedLessons.length ? detail.unresolvedLessons.map((lesson) => (
                  <div className="card" key={lesson.id}>
                    <div className="row" style={{justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div><strong>{lesson.student.lastName} {lesson.student.firstName}</strong><div className="muted">{lesson.subject.name}{lesson.student.gradeLevel ? ` · ${lesson.student.gradeLevel} клас` : ""}</div><div style={{marginTop:8}}>{dateTime(lesson.startsAt)}</div></div>
                      <div className="row"><span className={`badge ${lesson.sessionType === "FIRST" ? "first" : ""}`}>{lesson.sessionType === "FIRST" ? "Перше" : "Регулярне"}</span><span className={`badge ${lesson.fundingStatus.toLowerCase()}`}>{lesson.fundingStatus === "PAID" ? "Сплачено" : "Бронь"}</span></div>
                    </div>
                    <div className="row" style={{marginTop:14}}>
                      <button className="btn secondary" disabled={Boolean(busyKey)} onClick={()=>void findSubstitutes(lesson.id)}>Знайти заміну</button>
                      {lesson.canMoveToEnd && <button className="btn secondary" disabled={Boolean(busyKey)} onClick={()=>void moveToEnd(lesson.id)}>{busyKey === `move:${lesson.id}` ? "Переносимо…" : "Перенести в кінець"}</button>}
                    </div>
                    {!lesson.canMoveToEnd && <p className="muted form-note" style={{marginTop:10}}>Для першого уроку немає «кінця абонементу»: призначте заміну або перенесіть його через календар.</p>}

                    {candidateSessionId === lesson.id && <div className="substitute-picker">
                      {candidatesLoading ? <div className="empty compact-empty">Шукаємо доступних викладачів…</div> : candidates.length ? <>
                        <div className="field"><label>Викладач на заміну</label><select className="select" value={selectedCandidate} onChange={(event)=>setSelectedCandidate(event.target.value)}><option value="">Оберіть викладача</option>{candidates.map((candidate)=><option key={candidate.id} value={candidate.id}>{candidate.fullName}</option>)}</select></div>
                        <button className="btn" disabled={!selectedCandidate || Boolean(busyKey)} onClick={()=>void assignSubstitute(lesson.id)}>{busyKey === `sub:${lesson.id}` ? "Призначаємо…" : "Підтвердити заміну"}</button>
                      </> : <div className="notice-card">На цей час немає доступного викладача цього предмета.</div>}
                    </div>}
                  </div>
                )) : <div className="card success">Усі заняття цієї відпустки вже опрацьовані.</div>}
              </>}
            </div>
          ) : <div className="card empty">Запит недоступний.</div>}
        </section>
      </div>
    </PlatformShell>
  );
}
