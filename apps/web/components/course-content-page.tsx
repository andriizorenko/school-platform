"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { PlatformShell } from "./platform-shell";
import { CourseLearningProgressPanel } from "./course-learning-progress";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api").replace(/\/$/, "");

export function CourseEnrollmentPage({ role, enrollmentId }: { role: "PARENT" | "STUDENT"; enrollmentId: string }) {
  const [data, setData] = useState<any>(null); const [error, setError] = useState("");
  useEffect(() => { api<any>(`/course-enrollments/${enrollmentId}`).then(setData).catch((e: any) => setError(e.message)); }, [enrollmentId]);
  const modules = useMemo(() => { const map = new Map<string, { title: string; position: number; items: any[] }>(); for (const item of data?.items ?? []) { if (!map.has(item.module_id)) map.set(item.module_id, { title: item.module_title, position: item.module_position, items: [] }); map.get(item.module_id)!.items.push(item); } return [...map.values()].sort((a, b) => a.position - b.position); }, [data]);
  const completed = (data?.items ?? []).filter((item: any) => item.progress_status === "COMPLETED").length;
  return <PlatformShell allowedRoles={[role]}><div className="page-head"><div><h1>Навчальний курс</h1><p className="muted">Уроки можна проходити повторно. Низький результат тесту не блокує наступний матеріал.</p></div><div className="badge paid">{completed}/{data?.items?.length ?? 0} завершено</div></div>{error && <div className="error">{error}</div>}<CourseLearningProgressPanel role={role} enrollmentId={enrollmentId}/><div className="stack" style={{marginTop:16}}>{modules.map(module => <section className="card" key={module.position}><h2>{module.title}</h2><div className="stack">{module.items.map(item => <Link className="lesson-row" href={`/${role.toLowerCase()}/courses/${enrollmentId}/lessons/${item.lesson_id}`} key={item.lesson_id}><div><strong>{item.lesson_title}</strong><div className="muted">{item.description || ""}{item.estimated_minutes ? ` · ~${item.estimated_minutes} хв` : ""}</div></div><span className={`badge ${item.progress_status === "COMPLETED" ? "paid" : ""}`}>{item.progress_status === "COMPLETED" ? "Завершено" : item.progress_status === "IN_PROGRESS" ? "В процесі" : "Почати"}</span></Link>)}</div></section>)}</div></PlatformShell>;
}

function blockText(content: any) { if (!content) return ""; if (typeof content === "string") return content; if (content.text) return String(content.text); return JSON.stringify(content, null, 2); }

export function CourseLessonPage({ role, enrollmentId, lessonId }: { role: "PARENT" | "STUDENT"; enrollmentId: string; lessonId: string }) {
  const [data, setData] = useState<any>(null); const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [test, setTest] = useState<any>(null); const [answers, setAnswers] = useState<Record<string, string>>({}); const [result, setResult] = useState<any>(null);
  async function load() { try { setData(await api<any>(`/course-enrollments/${enrollmentId}/lessons/${lessonId}`)); } catch (e: any) { setError(e.message); } }
  useEffect(() => { void load(); }, [enrollmentId, lessonId]);
  async function start(testId: string) { try { setTest(await api<any>(`/course-enrollments/${enrollmentId}/tests/${testId}/start`, { method: "POST" })); setResult(null); setAnswers({}); } catch (e: any) { setError(e.message); } }
  async function finishTest() { try { for (const question of test.questions) await api(`/test-attempts/${test.attempt.id}/questions/${question.id}`, { method: "PATCH", body: JSON.stringify({ answer: answers[question.id] ?? "" }) }); setResult(await api<any>(`/test-attempts/${test.attempt.id}/complete`, { method: "POST" })); } catch (e: any) { setError(e.message); } }
  async function complete() { try { await api(`/course-enrollments/${enrollmentId}/lessons/${lessonId}/complete`, { method: "POST" }); history.back(); } catch (e: any) { setError(e.message); } }
  async function requestTutor(attemptId: string) { try { const response = await api<any>(`/course-enrollments/${enrollmentId}/tutor-request`, { method: "POST", body: JSON.stringify({ attemptId }) }); setMessage(response.alreadyExists ? "Заявка вже є у менеджера." : "Заявку на репетитора передано менеджеру."); } catch (e: any) { setError(e.message); } }
  const watermark = data?.enrollment ? `${data.enrollment.student_last_name ?? ""} ${data.enrollment.student_first_name ?? ""}`.trim() : "";
  return <PlatformShell allowedRoles={[role]}><div className="page-head"><div><h1>{data?.lesson?.title ?? "Урок"}</h1><p className="muted">{data?.lesson?.description}</p></div></div>{error && <div className="error">{error}</div>}{message && <div className="success">{message}</div>}<div className="stack">{(data?.blocks ?? []).map((block: any) => <section className="card lesson-block" key={block.id}>{block.type === "TEXT" && <div className="course-text">{blockText(block.content)}</div>}{block.type === "PDF" && <PdfViewer block={block} watermark={watermark} />}{block.type === "TEST" && block.test_id && <button className="btn" onClick={() => start(block.test_id)}>Почати тест</button>}</section>)}</div><button className="btn" style={{ marginTop: 16 }} onClick={complete}>Завершити урок</button>{test && <TestSheet test={test} answers={answers} setAnswers={setAnswers} result={result} onFinish={finishTest} onClose={() => setTest(null)} onTutorRequest={requestTutor} />}</PlatformShell>;
}

function PdfViewer({ block, watermark }: { block: any; watermark: string }) {
  const pages = Array.isArray(block.pdf_pages) ? block.pdf_pages : [];
  if (block.asset_status === "PROCESSING") return <div className="warning-note">Матеріал ще обробляється. Спробуйте оновити урок через кілька секунд.</div>;
  if (block.asset_status === "FAILED") return <div className="error">Не вдалося підготувати PDF для перегляду. Повідомте адміністратора.</div>;
  if (!pages.length) return <div className="muted">Сторінки PDF ще не готові.</div>;
  const watermarkPositions = [
    { left: "30%", top: "18%" },
    { left: "70%", top: "34%" },
    { left: "34%", top: "52%" },
    { left: "68%", top: "68%" },
    { left: "34%", top: "84%" },
  ];
  return <div className="pdf-page-viewer"><div className="muted">{pages.length} стор. · матеріал відкривається лише всередині платформи</div>{pages.map((page: any) => <div className="pdf-page" key={page.assetId}><img src={`${API_URL}/files/${page.assetId}/content`} alt={`Сторінка ${page.pageNumber}`} draggable={false} />{watermark && <div className="pdf-watermark-layer" aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none", overflow: "hidden" }}>{watermarkPositions.map((position, index) => <span key={index} style={{ position: "absolute", left: position.left, top: position.top, transform: "translate(-50%, -50%) rotate(-27deg)", fontSize: "clamp(18px, 2.5vw, 34px)", fontWeight: 800, letterSpacing: ".02em", color: "rgba(17, 26, 58, .13)", textShadow: "0 1px 0 rgba(255,255,255,.7)", whiteSpace: "nowrap", userSelect: "none" }}>{watermark}</span>)}</div>}<span className="pdf-page-number">{page.pageNumber}</span></div>)}</div>;
}

function TestSheet({ test, answers, setAnswers, result, onFinish, onClose, onTutorRequest }: any) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(test.attempt.timeLimitSeconds ?? null);
  useEffect(() => { if (!test.attempt.timeLimitSeconds || result) return; const started = new Date(test.attempt.started_at ?? Date.now()).getTime(); const deadline = started + Number(test.attempt.timeLimitSeconds) * 1000; const tick = () => setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))); tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer); }, [test, result]);
  const time = secondsLeft == null ? null : `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;
  return <div className="sheet-backdrop"><aside className="sheet"><button className="sheet-close" onClick={onClose}>×</button><div className="stack management-sheet-body"><div className="row" style={{ justifyContent: "space-between" }}><h2>Тест</h2>{time && <span className={`badge ${secondsLeft === 0 ? "booked" : ""}`}>⏱ {time}</span>}</div>{test.questions.map((question: any) => <div className="card compact-card" key={question.id}><strong>{question.prompt?.text ?? JSON.stringify(question.prompt)}</strong><input className="input" style={{ marginTop: 10 }} value={answers[question.id] ?? ""} onChange={e => setAnswers((value: any) => ({ ...value, [question.id]: e.target.value }))} placeholder="Ваша відповідь" disabled={Boolean(result) || secondsLeft === 0} /></div>)}{!result ? <button className="btn" onClick={onFinish} disabled={secondsLeft === 0}>Завершити тест</button> : <div className="stack"><div className={result.lowScore ? "error" : "success"}><strong>Результат: {result.percentage}%</strong>{result.lowScore && <><div>Рекомендуємо повторити тему. Курс не блокується — можна продовжити або пройти тест ще раз.</div>{result.weakTopics?.length > 0 && <div className="row" style={{marginTop:8}}>{result.weakTopics.map((topic:any)=><span className="badge booked" key={topic.id}>{topic.name}</span>)}</div>}<button className="btn" style={{marginTop:10}} onClick={() => onTutorRequest(result.attemptId)}>Підібрати репетитора</button></>}</div>{result.questions.map((question: any) => <div key={question.id} className="card compact-card"><strong>{question.isCorrect ? "Правильно" : "Неправильно"}</strong>{question.topicName && <div className="muted">Тема: {question.topicName}</div>}{question.explanationLocked && <div className="muted">Пояснення доступне у плані/доповненні з поясненнями.</div>}{question.explanation && <div className="course-explanation">{blockText(question.explanation)}</div>}</div>)}<div className="row"><button className="btn secondary" onClick={onClose}>Закрити</button></div></div>}</div></aside></div>;
}
