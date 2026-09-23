"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { dateOnly } from "../lib/format";
import { PlatformShell } from "./platform-shell";

function promptText(value: any) {
  if (!value) return "Завдання";
  if (typeof value === "string") return value;
  if (typeof value.text === "string") return value.text;
  return JSON.stringify(value);
}

function percentage(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

export function CourseLearningProgressPanel({ role, enrollmentId }: { role: "PARENT" | "STUDENT"; enrollmentId: string }) {
  const [summary, setSummary] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const [summaryData, historyData] = await Promise.all([
        api<any>(`/course-enrollments/${enrollmentId}/progress-summary`),
        api<any[]>(`/course-enrollments/${enrollmentId}/test-history`),
      ]);
      setSummary(summaryData);
      setHistory(historyData);
      setError("");
    } catch (e: any) { setError(e.message); }
  }
  useEffect(() => { void load(); }, [enrollmentId]);

  return <section id="course-progress" className="card course-progress-panel">
    <div className="row" style={{ justifyContent: "space-between" }}>
      <div><h2>Прогрес</h2><p className="muted">Уроки, результати тестів і персональний банк помилок.</p></div>
      <a className="btn secondary" href={`/${role.toLowerCase()}/courses/${enrollmentId}/mistakes`}>Мої помилки</a>
    </div>
    {error && <div className="error">{error}</div>}
    <div className="grid cols-4 course-progress-metrics">
      <div><div className="metric">{summary?.progressPercent ?? 0}%</div><div className="muted">курс пройдено</div></div>
      <div><div className="metric">{summary?.tests?.completed_attempts ?? 0}</div><div className="muted">тестів завершено</div></div>
      <div><div className="metric">{summary?.mistakes?.active_mistakes ?? 0}</div><div className="muted">активних помилок</div></div>
      <div><div className="metric">{summary?.tests?.best_percentage != null ? `${percentage(summary.tests.best_percentage)}%` : "—"}</div><div className="muted">кращий тест</div></div>
    </div>
    <div className="progress"><span style={{ width: `${summary?.progressPercent ?? 0}%` }} /></div>
    <h3 style={{ marginTop: 18 }}>Історія тестів</h3>
    <div className="stack">
      {history.slice(0, 8).map(attempt => <button className="history-list-row course-history-button" key={attempt.id} onClick={() => setAttemptId(attempt.id)}>
        <span><strong>{attempt.test_title}</strong><span className="muted"> · {attempt.test_type === "KNOWLEDGE_CHECK" ? "перевірка знань" : "міні-тест"}</span></span>
        <span className="row" style={{ justifyContent: "space-between" }}><span className="muted">{attempt.completed_at ? dateOnly(attempt.completed_at) : "не завершено"}</span><span className={`badge ${attempt.status === "COMPLETED" && Number(attempt.percentage) >= Number(attempt.low_score_threshold_percent ?? 40) ? "paid" : attempt.status === "COMPLETED" ? "booked" : ""}`}>{attempt.status === "COMPLETED" ? `${percentage(attempt.percentage)}%` : attempt.status}</span></span>
      </button>)}
      {!history.length && <div className="muted">Спроб тестів ще немає.</div>}
    </div>
    {attemptId && <AttemptResultSheet attemptId={attemptId} enrollmentId={enrollmentId} onClose={() => setAttemptId(null)} />}
  </section>;
}

export function AttemptResultSheet({ attemptId, enrollmentId, onClose }: { attemptId: string; enrollmentId: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => { api<any>(`/test-attempts/${attemptId}/result`).then(setData).catch((e: any) => setError(e.message)); }, [attemptId]);
  async function askTutor() {
    try {
      const result = await api<any>(`/course-enrollments/${enrollmentId}/tutor-request`, { method: "POST", body: JSON.stringify({ attemptId }) });
      setMessage(result.alreadyExists ? "Заявка вже передана менеджеру." : "Заявку передано менеджеру. Він звʼяжеться з батьками.");
    } catch (e: any) { setError(e.message); }
  }
  return <div className="sheet-backdrop" onClick={onClose}><aside className="sheet wide-sheet" onClick={e => e.stopPropagation()}><button className="sheet-close" onClick={onClose}>×</button><div className="stack management-sheet-body">
    <div><h2>{data?.attempt?.test_title ?? "Результат тесту"}</h2>{data?.attempt?.status === "COMPLETED" && <div className={`course-score ${data?.lowScore ? "low" : "good"}`}>{percentage(data?.attempt?.percentage)}%</div>}</div>
    {error && <div className="error">{error}</div>}{message && <div className="success">{message}</div>}
    {(data?.questions ?? []).map((question: any, index: number) => <div className="card compact-card" key={question.id}><div className="row" style={{ justifyContent: "space-between" }}><strong>Завдання {index + 1}</strong><span className={`badge ${question.is_correct ? "paid" : "booked"}`}>{question.is_correct ? "Правильно" : "Помилка"}</span></div><div>{promptText(question.generated_prompt)}</div>{question.topic_name && <div className="muted">Тема: {question.topic_name}</div>}<div className="muted">Відповідь учня: {promptText(question.student_answer)}</div>{question.explanationLocked && <div className="muted">Пояснення доступне у плані з поясненнями.</div>}{question.explanation && <div className="course-explanation">{promptText(question.explanation)}</div>}</div>)}
    {data?.lowScore && <div className="warning-note"><strong>Результат нижчий за рекомендований рівень.</strong><div>Можна повторити теми, попрактикувати помилки або передати менеджеру запит на індивідуальні заняття.</div><button className="btn" style={{ marginTop: 10 }} onClick={askTutor}>Підібрати репетитора</button></div>}
  </div></aside></div>;
}

export function CourseMistakesPage({ role, enrollmentId }: { role: "PARENT" | "STUDENT"; enrollmentId: string }) {
  const [rows, setRows] = useState<any[]>([]);
  const [status, setStatus] = useState<"ACTIVE" | "CORRECTED" | "ALL">("ACTIVE");
  const [practice, setPractice] = useState<any>(null);
  const [answer, setAnswer] = useState("");
  const [practiceResult, setPracticeResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    try { setRows(await api<any[]>(`/mistakes?courseEnrollmentId=${enrollmentId}`)); setError(""); }
    catch (e: any) { setError(e.message); }
  }
  useEffect(() => { void load(); }, [enrollmentId]);
  const visible = useMemo(() => status === "ALL" ? rows : rows.filter(row => row.status === status), [rows, status]);

  async function start(row: any) {
    try {
      const data = await api<any>(`/mistakes/${row.id}/practice/start`, { method: "POST", body: JSON.stringify({ courseEnrollmentId: enrollmentId }) });
      setPractice({ ...data, mistake: row }); setPracticeResult(null); setAnswer(""); setError("");
    } catch (e: any) { setError(e.message); }
  }
  async function submitPractice(event: FormEvent) {
    event.preventDefault();
    if (!practice?.attempt?.id) return;
    try {
      const data = await api<any>(`/mistake-practice/${practice.attempt.id}`, { method: "PATCH", body: JSON.stringify({ answer }) });
      setPracticeResult(data); await load();
    } catch (e: any) { setError(e.message); }
  }
  async function askTutor(row?: any) {
    try {
      const result = await api<any>(`/course-enrollments/${enrollmentId}/tutor-request`, { method: "POST", body: JSON.stringify({ topicId: row?.topic_id || undefined }) });
      setMessage(result.alreadyExists ? "Заявка з цієї теми вже є у менеджера." : "Заявку створено. Менеджер звʼяжеться з батьками.");
    } catch (e: any) { setError(e.message); }
  }

  const activeCount = rows.filter(row => row.status === "ACTIVE").length;
  return <PlatformShell allowedRoles={[role]}><div className="page-head"><div><div className="muted"><a href={`/${role.toLowerCase()}/courses/${enrollmentId}`}>Курс</a> / Мої помилки</div><h1>Мої помилки</h1><p className="muted">Неправильні відповіді з тестів. Для генерованих завдань система дає аналогічний приклад з іншими числами.</p></div>{activeCount > 0 && <button className="btn secondary" onClick={() => askTutor()}>Потрібна допомога викладача</button>}</div>
    {error && <div className="error">{error}</div>}{message && <div className="success">{message}</div>}
    <div className="row course-filter-row"><button className={`btn ${status === "ACTIVE" ? "" : "secondary"}`} onClick={() => setStatus("ACTIVE")}>Активні ({activeCount})</button><button className={`btn ${status === "CORRECTED" ? "" : "secondary"}`} onClick={() => setStatus("CORRECTED")}>Виправлені ({rows.filter(r => r.status === "CORRECTED").length})</button><button className={`btn ${status === "ALL" ? "" : "secondary"}`} onClick={() => setStatus("ALL")}>Усі</button></div>
    <div className="stack">{visible.map(row => <article className="card mistake-card" key={row.id}><div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}><div><span className={`badge ${row.status === "CORRECTED" ? "paid" : "booked"}`}>{row.status === "CORRECTED" ? "Виправлено" : "Потрібно повторити"}</span><h2>{row.topic_name ?? "Завдання без теми"}</h2><div className="course-question-preview">{promptText(row.first_wrong_prompt ?? row.prompt_template)}</div><div className="muted">Помилок у тестах: {row.wrong_count} · тренувань: {row.practice_attempt_count ?? 0}</div>{row.question_type === "STATIC" && <div className="muted">Для цього статичного завдання аналогічний генератор ще не налаштований — тренування повторить базове завдання.</div>}</div><div className="stack mistake-actions"><button className="btn" onClick={() => start(row)}>Попрактикуватися</button><button className="btn secondary" onClick={() => askTutor(row)}>Репетитор по темі</button></div></div></article>)}{!visible.length && <div className="card muted">Тут поки порожньо.</div>}</div>
    {practice && <div className="sheet-backdrop" onClick={() => setPractice(null)}><aside className="sheet" onClick={e => e.stopPropagation()}><button className="sheet-close" onClick={() => setPractice(null)}>×</button><form className="stack management-sheet-body" onSubmit={submitPractice}><div><h2>{practice.topicName ?? "Тренування"}</h2><p className="muted">{practice.attempt.analogous ? "Аналогічне завдання з новими даними." : "Повтор базового статичного завдання."}</p></div><div className="card compact-card course-practice-question"><strong>{promptText(practice.attempt.generated_prompt)}</strong></div><div className="field"><label>Відповідь</label><input className="input" value={answer} onChange={e => setAnswer(e.target.value)} disabled={Boolean(practiceResult)} autoFocus /></div>{!practiceResult ? <button className="btn">Перевірити</button> : <div className={practiceResult.isCorrect ? "success" : "error"}><strong>{practiceResult.isCorrect ? "Правильно — помилку виправлено." : "Поки що ні. Спробуйте ще один аналогічний приклад."}</strong>{practiceResult.explanationLocked && <div>Пояснення доступне у плані з поясненнями.</div>}{practiceResult.explanation && <div className="course-explanation">{promptText(practiceResult.explanation)}</div>}</div>}{practiceResult && <div className="row"><button type="button" className="btn" onClick={() => start(practice.mistake)}>Ще приклад</button><button type="button" className="btn secondary" onClick={() => setPractice(null)}>Закрити</button></div>}</form></aside></div>}
  </PlatformShell>;
}

export function AdminCourseStudentProgressSheet({ enrollmentId, onClose }: { enrollmentId: string; onClose: () => void }) {
  const [summary, setSummary] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [mistakes, setMistakes] = useState<any[]>([]);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { Promise.all([
    api<any>(`/course-enrollments/${enrollmentId}/progress-summary`),
    api<any[]>(`/course-enrollments/${enrollmentId}/test-history`),
    api<any[]>(`/mistakes?courseEnrollmentId=${enrollmentId}`),
  ]).then(([s,h,m]) => { setSummary(s); setHistory(h); setMistakes(m); }).catch((e: any) => setError(e.message)); }, [enrollmentId]);
  return <div className="sheet-backdrop" onClick={onClose}><aside className="sheet wide-sheet" onClick={e => e.stopPropagation()}><button className="sheet-close" onClick={onClose}>×</button><div className="stack management-sheet-body"><div><h2>{summary ? `${summary.last_name} ${summary.first_name}` : "Прогрес учня"}</h2><p className="muted">{summary?.course_title}</p></div>{error && <div className="error">{error}</div>}
    <div className="grid cols-4 course-progress-metrics"><div><div className="metric">{summary?.progressPercent ?? 0}%</div><div className="muted">курс</div></div><div><div className="metric">{summary?.tests?.completed_attempts ?? 0}</div><div className="muted">тестів</div></div><div><div className="metric">{summary?.mistakes?.active_mistakes ?? 0}</div><div className="muted">активних помилок</div></div><div><div className="metric">{summary?.tests?.average_percentage != null ? `${percentage(summary.tests.average_percentage)}%` : "—"}</div><div className="muted">середній тест</div></div></div>
    <h3>Останні тести</h3>{history.slice(0,8).map(row => <button className="history-list-row course-history-button" key={row.id} onClick={() => setAttemptId(row.id)}><strong>{row.test_title}</strong><span className="row" style={{ justifyContent: "space-between" }}><span className="muted">{row.completed_at ? dateOnly(row.completed_at) : row.status}</span><span>{row.status === "COMPLETED" ? `${percentage(row.percentage)}%` : row.status}</span></span></button>)}
    <h3>Помилки</h3>{mistakes.filter(row => row.status === "ACTIVE").slice(0,10).map(row => <div className="history-list-row" key={row.id}><strong>{row.topic_name ?? "Без теми"}</strong><span className="muted">{row.wrong_count} помилок · {row.practice_attempt_count ?? 0} тренувань</span></div>)}{!mistakes.some(row => row.status === "ACTIVE") && <div className="muted">Активних помилок немає.</div>}
    {attemptId && <AttemptResultSheet attemptId={attemptId} enrollmentId={enrollmentId} onClose={() => setAttemptId(null)} />}
  </div></aside></div>;
}
