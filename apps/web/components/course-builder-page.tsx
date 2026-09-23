"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { money } from "../lib/format";
import { PlatformShell } from "./platform-shell";
import { AdminCourseStudentProgressSheet } from "./course-learning-progress";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api").replace(/\/$/, "");

type Detail = { course: any; modules: any[]; plans: any[] };

function move<T>(items: T[], from: number, to: number) {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item === undefined) return items;
  next.splice(to, 0, item);
  return next;
}

export function CourseBuilderPage({ courseId }: { courseId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [selectedLesson, setSelectedLesson] = useState<string | null>(null);
  const [progress, setProgress] = useState<any>(null);
  const [progressEnrollmentId, setProgressEnrollmentId] = useState<string | null>(null);
  const [moduleTitle, setModuleTitle] = useState("");
  const [lessonModule, setLessonModule] = useState<string | null>(null);
  const [lessonTitle, setLessonTitle] = useState("");
  const [showPlan, setShowPlan] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dragModuleId, setDragModuleId] = useState<string | null>(null);
  const [dragLesson, setDragLesson] = useState<{ moduleId: string; lessonId: string } | null>(null);

  async function load() {
    try {
      const [course, subjectRows, progressData] = await Promise.all([api<Detail>(`/courses/${courseId}`), api<any[]>("/subjects"), api<any>(`/courses/${courseId}/progress-overview`)]);
      setDetail(course); setSubjects(subjectRows); setProgress(progressData); setError("");
    } catch (e: any) { setError(e.message); }
  }
  useEffect(() => { void load(); }, [courseId]);

  async function saveCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!detail) return;
    const form = new FormData(event.currentTarget);
    try {
      await api(`/courses/${courseId}`, { method: "PATCH", body: JSON.stringify({ title: form.get("title"), slug: form.get("slug"), description: form.get("description"), subjectId: form.get("subjectId") || undefined }) });
      setMessage("Дані курсу збережено"); void load();
    } catch (e: any) { setError(e.message); }
  }

  async function uploadCover(file?: File) {
    if (!file) return;
    try {
      const data = new FormData(); data.append("file", file); data.append("type", "COURSE_COVER");
      const asset = await api<any>("/files", { method: "POST", body: data });
      await api(`/courses/${courseId}`, { method: "PATCH", body: JSON.stringify({ coverAssetId: asset.id }) });
      setMessage("Обкладинку оновлено"); void load();
    } catch (e: any) { setError(e.message); }
  }

  async function addModule(event: FormEvent) {
    event.preventDefault(); if (!detail || !moduleTitle.trim()) return;
    try { await api(`/courses/${courseId}/modules`, { method: "POST", body: JSON.stringify({ title: moduleTitle.trim(), position: detail.modules.length + 1 }) }); setModuleTitle(""); void load(); } catch (e: any) { setError(e.message); }
  }

  async function addLesson(event: FormEvent) {
    event.preventDefault(); if (!detail || !lessonModule || !lessonTitle.trim()) return;
    const module = detail.modules.find(item => item.id === lessonModule);
    try {
      const lesson = await api<any>(`/course-modules/${lessonModule}/lessons`, { method: "POST", body: JSON.stringify({ title: lessonTitle.trim(), position: (module?.lessons?.length ?? 0) + 1 }) });
      setLessonTitle(""); setLessonModule(null); await load(); setSelectedLesson(lesson.id);
    } catch (e: any) { setError(e.message); }
  }

  async function reorderModules(ids: string[]) {
    if (!detail) return;
    const map = new Map(detail.modules.map(m => [m.id, m]));
    setDetail({ ...detail, modules: ids.map(id => map.get(id)).filter(Boolean) });
    try { await api(`/courses/${courseId}/modules/order`, { method: "PUT", body: JSON.stringify({ ids }) }); } catch (e: any) { setError(e.message); void load(); }
  }

  async function reorderLessons(moduleId: string, ids: string[]) {
    if (!detail) return;
    setDetail({ ...detail, modules: detail.modules.map(module => module.id !== moduleId ? module : { ...module, lessons: ids.map(id => module.lessons.find((lesson: any) => lesson.id === id)).filter(Boolean) }) });
    try { await api(`/course-modules/${moduleId}/lessons/order`, { method: "PUT", body: JSON.stringify({ ids }) }); } catch (e: any) { setError(e.message); void load(); }
  }

  async function publish() { try { await api(`/courses/${courseId}/publish`, { method: "POST" }); setMessage("Курс опубліковано"); void load(); } catch (e: any) { setError(e.message); } }
  async function archive() { if (!confirm("Приховати курс із каталогу? Активні доступи учнів та історія не видаляються.")) return; try { await api(`/courses/${courseId}/archive`, { method: "POST" }); void load(); } catch (e: any) { setError(e.message); } }

  if (!detail) return <PlatformShell allowedRoles={["ADMIN"]}><div className="card">Завантаження конструктора…</div>{error && <div className="error">{error}</div>}</PlatformShell>;

  return <PlatformShell allowedRoles={["ADMIN"]}>
    <div className="page-head"><div><div className="muted"><Link href="/admin/courses">Курси</Link> / Конструктор</div><h1>{detail.course.title}</h1><p className="muted">Модулі, уроки, матеріали, тести та плани доступу.</p></div><div className="row">{detail.course.status !== "PUBLISHED" && <button className="btn" onClick={publish}>Опублікувати курс</button>}<button className="btn secondary" onClick={archive}>Архівувати</button></div></div>
    {error && <div className="error">{error}</div>}{message && <div className="success">{message}</div>}

    <div className="course-builder-layout">
      <div className="stack">
        <form className="card" onSubmit={saveCourse}>
          <div className="row" style={{ justifyContent: "space-between" }}><h2>Налаштування курсу</h2><span className="badge">{detail.course.status}</span></div>
          <div className="grid cols-2">
            <div className="field"><label>Назва</label><input className="input" name="title" defaultValue={detail.course.title} required /></div>
            <div className="field"><label>Slug</label><input className="input" name="slug" defaultValue={detail.course.slug} required /></div>
            <div className="field"><label>Предмет</label><select className="select" name="subjectId" defaultValue={detail.course.subject_id ?? ""}><option value="">Без предмета</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div className="field"><label>Обкладинка</label><input className="input" type="file" accept="image/*" onChange={e => void uploadCover(e.target.files?.[0])} /></div>
          </div>
          <div className="field" style={{ marginTop: 12 }}><label>Опис</label><textarea className="textarea" name="description" defaultValue={detail.course.description ?? ""} rows={3} /></div>
          <button className="btn secondary" style={{ marginTop: 12 }} type="submit">Зберегти</button>
        </form>

        <section className="card">
          <div className="row" style={{ justifyContent: "space-between" }}><div><h2>Структура курсу</h2><p className="muted">Перетягуйте модулі та уроки. На телефоні використовуйте стрілки.</p></div></div>
          <form className="row" onSubmit={addModule}><input className="input" style={{ maxWidth: 420 }} placeholder="Назва нового модуля" value={moduleTitle} onChange={e => setModuleTitle(e.target.value)} /><button className="btn secondary">+ Модуль</button></form>
          <div className="course-module-list">
            {detail.modules.map((module, moduleIndex) => <article key={module.id} className="course-builder-module" draggable onDragStart={() => setDragModuleId(module.id)} onDragOver={e => e.preventDefault()} onDrop={() => { if (!dragModuleId || dragModuleId === module.id) return; const from = detail.modules.findIndex(m => m.id === dragModuleId); const next = move(detail.modules, from, moduleIndex); void reorderModules(next.map(m => m.id)); setDragModuleId(null); }}>
              <div className="course-builder-module-head"><div><span className="drag-handle">⋮⋮</span><strong>{module.position}. {module.title}</strong><div className="muted">{module.description || `${module.lessons.length} уроків`}</div></div><div className="row"><button className="btn secondary tiny-btn" disabled={moduleIndex === 0} onClick={() => void reorderModules(move(detail.modules, moduleIndex, moduleIndex - 1).map(m => m.id))}>↑</button><button className="btn secondary tiny-btn" disabled={moduleIndex === detail.modules.length - 1} onClick={() => void reorderModules(move(detail.modules, moduleIndex, moduleIndex + 1).map(m => m.id))}>↓</button><button className="btn secondary" onClick={() => setLessonModule(module.id)}>+ Урок</button></div></div>
              {lessonModule === module.id && <form className="row inline-builder-form" onSubmit={addLesson}><input autoFocus className="input" placeholder="Назва уроку" value={lessonTitle} onChange={e => setLessonTitle(e.target.value)} /><button className="btn">Створити</button><button type="button" className="btn secondary" onClick={() => setLessonModule(null)}>Скасувати</button></form>}
              <div className="course-builder-lessons">{module.lessons.map((lesson: any, lessonIndex: number) => <div key={lesson.id} className="course-builder-lesson" draggable onDragStart={() => setDragLesson({ moduleId: module.id, lessonId: lesson.id })} onDragOver={e => e.preventDefault()} onDrop={() => { if (!dragLesson || dragLesson.moduleId !== module.id || dragLesson.lessonId === lesson.id) return; const from = module.lessons.findIndex((item: any) => item.id === dragLesson.lessonId); const next = move(module.lessons, from, lessonIndex); void reorderLessons(module.id, next.map((item: any) => item.id)); setDragLesson(null); }}>
                <button className="course-lesson-main" onClick={() => setSelectedLesson(lesson.id)}><span className="drag-handle">⋮⋮</span><span><strong>{lesson.position}. {lesson.title}</strong><small>{lesson.blockCount ?? 0} блоків</small></span></button><div className="row"><span className={`badge ${lesson.isPublished ? "paid" : ""}`}>{lesson.isPublished ? "Опубліковано" : "Чернетка"}</span><button className="btn secondary tiny-btn" disabled={lessonIndex === 0} onClick={() => void reorderLessons(module.id, move(module.lessons, lessonIndex, lessonIndex - 1).map((item: any) => item.id))}>↑</button><button className="btn secondary tiny-btn" disabled={lessonIndex === module.lessons.length - 1} onClick={() => void reorderLessons(module.id, move(module.lessons, lessonIndex, lessonIndex + 1).map((item: any) => item.id))}>↓</button></div>
              </div>)}</div>
            </article>)}
          </div>
        </section>

        <section className="card"><div className="row" style={{ justifyContent: "space-between" }}><div><h2>Плани доступу</h2><p className="muted">Тривалість/фіксований дедлайн, ціна та доступ до пояснень тестів.</p></div><button className="btn secondary" onClick={() => setShowPlan(true)}>+ План</button></div><div className="stack">{detail.plans.map(plan => <PlanRow key={plan.id} plan={plan} onSaved={load} onError={setError} />)}{!detail.plans.length && <div className="muted">Планів ще немає.</div>}</div></section>
      </div>
      <aside className="stack course-builder-help"><div className="card"><h2>Готовність до публікації</h2><Readiness detail={detail} /><p className="muted" style={{marginTop:12}}>Курс можна опублікувати, коли є хоча б один модуль, один опублікований урок із контентом та один активний план доступу.</p></div><div className="card"><h2>Доступ і прогрес</h2><div className="grid cols-2"><div><div className="metric">{progress?.active_licenses ?? 0}</div><div className="muted">активних ліцензій</div></div><div><div className="metric">{progress?.enrolled_students ?? 0}</div><div className="muted">учнів</div></div></div><div style={{marginTop:14}}><strong>Середній прогрес: {progress?.averageProgressPercent ?? 0}%</strong><div className="progress"><span style={{width:`${progress?.averageProgressPercent ?? 0}%`}} /></div></div>{progress?.students?.slice(0,8).map((student:any)=><button className="history-list-row course-history-button" key={student.course_enrollment_id} onClick={() => setProgressEnrollmentId(student.course_enrollment_id)}><strong>{student.last_name} {student.first_name}</strong><span className="muted">{student.completed_count}/{student.lesson_count} · {student.progressPercent}%</span></button>)}</div></aside>{progressEnrollmentId && <AdminCourseStudentProgressSheet enrollmentId={progressEnrollmentId} onClose={() => setProgressEnrollmentId(null)}/>}
    </div>

    {showPlan && <PlanForm courseId={courseId} onClose={() => setShowPlan(false)} onSaved={() => { setShowPlan(false); void load(); }} onError={setError} />}
    {selectedLesson && <LessonBuilder lessonId={selectedLesson} onClose={() => { setSelectedLesson(null); void load(); }} />}
  </PlatformShell>;
}

function Readiness({ detail }: { detail: Detail }) {
  const lessons = detail.modules.flatMap(module => module.lessons ?? []);
  const checks = [
    [detail.modules.length > 0, "Є модуль"],
    [lessons.some((lesson: any) => lesson.isPublished), "Є опублікований урок"],
    [lessons.some((lesson: any) => Number(lesson.blockCount) > 0), "Є навчальний контент"],
    [detail.plans.some(plan => plan.is_active), "Є активний план доступу"],
  ] as const;
  return <div className="stack">{checks.map(([ok, label]) => <div className="row" key={label}><span className={`badge ${ok ? "paid" : "booked"}`}>{ok ? "✓" : "!"}</span><span>{label}</span></div>)}</div>;
}

function PlanRow({ plan, onSaved, onError }: { plan: any; onSaved: () => void; onError: (message: string) => void }) {
  async function toggle() { try { await api(`/course-access-plans/${plan.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !plan.is_active }) }); onSaved(); } catch (e: any) { onError(e.message); } }
  return <div className="lesson-row"><div><strong>{plan.name}</strong><div className="muted">{plan.access_type === "DURATION" ? `${plan.duration_months} міс.` : `до ${plan.fixed_expiry_date}`} · {plan.explanations_enabled ? "з поясненнями" : "без пояснень"}</div></div><div className="row"><strong>{money(plan.price_minor)}</strong><span className={`badge ${plan.is_active ? "paid" : ""}`}>{plan.is_active ? "Активний" : "Вимкнений"}</span><button className="btn secondary" onClick={toggle}>{plan.is_active ? "Вимкнути" : "Увімкнути"}</button></div></div>;
}

function PlanForm({ courseId, onClose, onSaved, onError }: { courseId: string; onClose: () => void; onSaved: () => void; onError: (message: string) => void }) {
  const [type, setType] = useState<"DURATION" | "FIXED_EXPIRY">("DURATION");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { await api(`/courses/${courseId}/access-plans`, { method: "POST", body: JSON.stringify({ name: form.get("name"), accessType: type, durationMonths: type === "DURATION" ? Number(form.get("months")) : undefined, fixedExpiryDate: type === "FIXED_EXPIRY" ? form.get("expiry") : undefined, priceMinor: Math.round(Number(form.get("price")) * 100), explanationsEnabled: form.get("explanations") === "on" }) }); onSaved(); } catch (e: any) { onError(e.message); }
  }
  return <div className="sheet-backdrop" onClick={onClose}><aside className="sheet" onClick={e => e.stopPropagation()}><button className="sheet-close" onClick={onClose}>×</button><form className="stack management-sheet-body" onSubmit={submit}><h2>Новий план доступу</h2><div className="field"><label>Назва</label><input className="input" name="name" defaultValue="6 місяців" required /></div><div className="field"><label>Тип</label><select className="select" value={type} onChange={e => setType(e.target.value as any)}><option value="DURATION">Тривалість</option><option value="FIXED_EXPIRY">Фіксована дата завершення</option></select></div>{type === "DURATION" ? <div className="field"><label>Місяців</label><input className="input" name="months" type="number" min="1" defaultValue="6" required /></div> : <div className="field"><label>Доступ до</label><input className="input" name="expiry" type="date" required /></div>}<div className="field"><label>Ціна, грн</label><input className="input" name="price" type="number" min="0" step="0.01" defaultValue="1499" required /></div><label className="row"><input name="explanations" type="checkbox" /> Показувати пояснення до відповідей</label><button className="btn">Створити план</button></form></aside></div>;
}

function LessonBuilder({ lessonId, onClose }: { lessonId: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [mode, setMode] = useState<"TEXT" | "PDF" | "TEST" | null>(null);
  const [error, setError] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  async function load() { try { setData(await api(`/course-lessons/${lessonId}/builder`)); setError(""); } catch (e: any) { setError(e.message); } }
  useEffect(() => { void load(); }, [lessonId]);
  async function saveLesson(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); try { await api(`/course-lessons/${lessonId}`, { method: "PATCH", body: JSON.stringify({ title: form.get("title"), description: form.get("description"), estimatedMinutes: form.get("estimatedMinutes") ? Number(form.get("estimatedMinutes")) : undefined }) }); void load(); } catch (e: any) { setError(e.message); } }
  async function togglePublish() { try { await api(`/course-lessons/${lessonId}/${data.lesson.is_published ? "unpublish" : "publish"}`, { method: "POST" }); void load(); } catch (e: any) { setError(e.message); } }
  async function deleteBlock(id: string) { if (!confirm("Видалити цей блок з уроку?")) return; try { await api(`/course-blocks/${id}`, { method: "DELETE" }); void load(); } catch (e: any) { setError(e.message); } }
  async function reorder(ids: string[]) { const map = new Map(data.blocks.map((b: any) => [b.id, b])); setData({ ...data, blocks: ids.map(id => map.get(id)).filter(Boolean) }); try { await api(`/course-lessons/${lessonId}/blocks/order`, { method: "PUT", body: JSON.stringify({ ids }) }); } catch (e: any) { setError(e.message); void load(); } }
  if (!data) return <div className="sheet-backdrop"><aside className="sheet wide-sheet"><button className="sheet-close" onClick={onClose}>×</button><div style={{ marginTop: 40 }}>Завантаження…</div></aside></div>;
  return <div className="sheet-backdrop" onClick={onClose}><aside className="sheet course-lesson-builder-sheet" onClick={e => e.stopPropagation()}><button className="sheet-close" onClick={onClose}>×</button><div className="stack management-sheet-body"><div className="row" style={{ justifyContent: "space-between" }}><div><div className="muted">{data.lesson.course_title} · {data.lesson.module_title}</div><h2>{data.lesson.title}</h2></div><button className={`btn ${data.lesson.is_published ? "secondary" : ""}`} onClick={togglePublish}>{data.lesson.is_published ? "Зняти з публікації" : "Опублікувати урок"}</button></div>{error && <div className="error">{error}</div>}
    <form className="card compact-card stack" onSubmit={saveLesson}><div className="grid cols-2"><div className="field"><label>Назва уроку</label><input className="input" name="title" defaultValue={data.lesson.title} /></div><div className="field"><label>Орієнтовно, хв</label><input className="input" type="number" min="1" name="estimatedMinutes" defaultValue={data.lesson.estimated_minutes ?? ""} /></div></div><div className="field"><label>Опис</label><textarea className="textarea" name="description" defaultValue={data.lesson.description ?? ""} rows={2} /></div><button className="btn secondary">Зберегти урок</button></form>
    <div className="row"><button className="btn secondary" onClick={() => setMode("TEXT")}>+ Текст</button><button className="btn secondary" onClick={() => setMode("PDF")}>+ PDF</button><button className="btn secondary" onClick={() => setMode("TEST")}>+ Тест</button></div>
    {mode === "TEXT" && <TextBlockForm lessonId={lessonId} position={data.blocks.length + 1} onDone={() => { setMode(null); void load(); }} onError={setError} />}
    {mode === "PDF" && <PdfBlockForm lessonId={lessonId} position={data.blocks.length + 1} onDone={() => { setMode(null); void load(); }} onError={setError} />}
    {mode === "TEST" && <TestBlockForm lessonId={lessonId} subjectId={data.lesson.subject_id} position={data.blocks.length + 1} onDone={() => { setMode(null); void load(); }} onError={setError} />}
    <div className="stack">{data.blocks.map((block: any, index: number) => <div className="course-block-card" key={block.id} draggable onDragStart={() => setDragId(block.id)} onDragOver={e => e.preventDefault()} onDrop={() => { if (!dragId || dragId === block.id) return; const from = data.blocks.findIndex((item: any) => item.id === dragId); void reorder(move(data.blocks, from, index).map((item: any) => item.id)); setDragId(null); }}><div className="row" style={{ justifyContent: "space-between" }}><div className="row"><span className="drag-handle">⋮⋮</span><span className="badge">{block.type}</span><strong>Блок {index + 1}</strong></div><div className="row"><button className="btn secondary tiny-btn" disabled={index === 0} onClick={() => void reorder(move(data.blocks, index, index - 1).map((item: any) => item.id))}>↑</button><button className="btn secondary tiny-btn" disabled={index === data.blocks.length - 1} onClick={() => void reorder(move(data.blocks, index, index + 1).map((item: any) => item.id))}>↓</button><button className="btn danger tiny-btn" onClick={() => void deleteBlock(block.id)}>Видалити</button></div></div>{block.type === "TEXT" && <TextBlock block={block} onSaved={load} onError={setError} />}{block.type === "PDF" && <div className="stack"><div><strong>{block.original_filename}</strong></div><div className="row"><span className={`badge ${block.asset_status === "READY" ? "paid" : "booked"}`}>{block.asset_status}</span><span className="muted">{block.pdf_page_count ? `${block.pdf_page_count} стор.` : block.processing_error || "Обробляємо PDF…"}</span></div>{block.asset_status === "READY" && <a className="btn secondary" target="_blank" href={`${API_URL}/files/${block.asset_id}/content`}>Перевірити оригінал (Admin)</a>}</div>}{block.type === "TEST" && <TestBlockEditor testId={block.test_id} subjectId={data.lesson.subject_id} onError={setError} />}</div>)}</div>
  </div></aside></div>;
}

function TextBlockForm({ lessonId, position, onDone, onError }: any) { const [text, setText] = useState(""); async function submit(e: FormEvent) { e.preventDefault(); try { await api(`/course-lessons/${lessonId}/blocks`, { method: "POST", body: JSON.stringify({ type: "TEXT", position, content: { text } }) }); onDone(); } catch (err: any) { onError(err.message); } } return <form className="card compact-card stack" onSubmit={submit}><h3>Текстовий блок</h3><textarea className="textarea" rows={7} value={text} onChange={e => setText(e.target.value)} placeholder="Текст, конспект, формули в текстовому вигляді…" required /><button className="btn">Додати текст</button></form>; }
function TextBlock({ block, onSaved, onError }: any) { const [text, setText] = useState(block.content?.text ?? ""); async function save() { try { await api(`/course-blocks/${block.id}`, { method: "PATCH", body: JSON.stringify({ content: { text } }) }); onSaved(); } catch (e: any) { onError(e.message); } } return <div className="stack"><textarea className="textarea" rows={5} value={text} onChange={e => setText(e.target.value)} /><button className="btn secondary" onClick={save}>Зберегти текст</button></div>; }

function PdfBlockForm({ lessonId, position, onDone, onError }: any) { const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false); async function submit(e: FormEvent) { e.preventDefault(); if (!file) return; setBusy(true); try { const data = new FormData(); data.append("file", file); data.append("type", "PDF"); const asset = await api<any>("/files", { method: "POST", body: data }); await api(`/course-lessons/${lessonId}/blocks`, { method: "POST", body: JSON.stringify({ type: "PDF", position, assetId: asset.id }) }); onDone(); } catch (err: any) { onError(err.message); } finally { setBusy(false); } } return <form className="card compact-card stack" onSubmit={submit}><h3>PDF-презентація</h3><input className="input" type="file" accept="application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} required /><p className="muted">PDF зберігається приватно. Worker перетворить його на окремі сторінки для viewer учня.</p><button className="btn" disabled={busy}>{busy ? "Завантаження…" : "Додати PDF"}</button></form>; }

function TestBlockForm({ lessonId, subjectId, position, onDone, onError }: any) { const [type, setType] = useState("MINI"); async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const form = new FormData(e.currentTarget); try { const test = await api<any>("/tests", { method: "POST", body: JSON.stringify({ title: form.get("title"), type, timeLimitSeconds: type === "KNOWLEDGE_CHECK" ? Number(form.get("minutes")) * 60 : undefined, lowScoreThresholdPercent: Number(form.get("threshold") || 40) }) }); await api(`/course-lessons/${lessonId}/blocks`, { method: "POST", body: JSON.stringify({ type: "TEST", position, testId: test.id }) }); onDone(); } catch (err: any) { onError(err.message); } } return <form className="card compact-card stack" onSubmit={submit}><h3>Новий тест</h3><div className="field"><label>Назва</label><input className="input" name="title" required /></div><div className="field"><label>Тип</label><select className="select" value={type} onChange={e => setType(e.target.value)}><option value="MINI">Міні-тест без таймера</option><option value="KNOWLEDGE_CHECK">Перевірка знань з таймером</option></select></div>{type === "KNOWLEDGE_CHECK" && <div className="field"><label>Хвилин</label><input className="input" name="minutes" type="number" min="1" defaultValue="20" required /></div>}<div className="field"><label>Порог низького результату, %</label><input className="input" name="threshold" type="number" min="0" max="100" defaultValue="40" /></div><input type="hidden" value={subjectId ?? ""} /><button className="btn">Створити тест</button></form>; }

function TestBlockEditor({ testId, subjectId, onError }: { testId: string; subjectId?: string; onError: (message: string) => void }) { const [data, setData] = useState<any>(null); const [showQuestion, setShowQuestion] = useState(false); async function load() { try { setData(await api(`/tests/${testId}`)); } catch (e: any) { onError(e.message); } } useEffect(() => { void load(); }, [testId]); if (!data) return <div className="muted">Завантаження тесту…</div>; return <div className="stack"><div className="row" style={{ justifyContent: "space-between" }}><div><strong>{data.test.title}</strong><div className="muted">{data.test.type === "KNOWLEDGE_CHECK" ? `Таймер ${Math.round(data.test.time_limit_seconds / 60)} хв` : "Без таймера"} · поріг {data.test.low_score_threshold_percent}%</div></div><button className="btn secondary" onClick={() => setShowQuestion(v => !v)}>+ Питання</button></div>{showQuestion && <QuestionForm testId={testId} subjectId={subjectId} position={data.questions.length + 1} onDone={() => { setShowQuestion(false); void load(); }} onError={onError} />}{data.questions.map((question: any) => <div className="test-question-row" key={question.test_question_id}><div><span className="badge">{question.type}</span> <strong>{question.prompt_template?.text ?? "Питання"}</strong><div className="muted">{question.topic_name || "Без теми"} · {question.points} б.</div></div></div>)}{!data.questions.length && <div className="muted">Додайте хоча б одне питання.</div>}</div>; }

function QuestionForm({ testId, subjectId, position, onDone, onError }: any) {
  const [kind, setKind] = useState<"STATIC" | "GENERATED">("STATIC");
  const [generator, setGenerator] = useState("ARITHMETIC");
  const [topics, setTopics] = useState<any[]>([]);
  const [topicId, setTopicId] = useState("");
  const [newTopic, setNewTopic] = useState("");
  useEffect(() => { if (subjectId) api<any[]>(`/subject-topics?subjectId=${subjectId}`).then(setTopics).catch(() => undefined); }, [subjectId]);
  async function createTopic() {
    if (!subjectId || !newTopic.trim()) return;
    try {
      const topic = await api<any>("/subject-topics", { method: "POST", body: JSON.stringify({ subjectId, name: newTopic.trim() }) });
      setTopics(current => [...current, topic]); setTopicId(topic.id); setNewTopic("");
    } catch (err: any) { onError(err.message); }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = new FormData(e.currentTarget);
    try {
      let body: any;
      if (kind === "STATIC") {
        const answer = String(form.get("answer") ?? ""); const numeric = form.get("numeric") === "on";
        body = { type: "STATIC", topicId: topicId || undefined, promptTemplate: { text: String(form.get("prompt")) }, answerDefinition: { type: numeric ? "NUMBER" : "TEXT", correct: numeric ? Number(answer) : answer }, explanationContent: form.get("explanation") ? { text: String(form.get("explanation")) } : undefined, position, points: Number(form.get("points") || 1) };
      } else if (generator === "ARITHMETIC") {
        body = { type: "GENERATED", topicId: topicId || undefined, promptTemplate: { text: "Generated arithmetic" }, answerDefinition: { type: "NUMBER" }, generatorDefinition: { kind: "ARITHMETIC", min: Number(form.get("min") || 1), max: Number(form.get("max") || 100), operation: form.get("operation") }, explanationContent: form.get("explanation") ? { text: String(form.get("explanation")) } : undefined, position, points: Number(form.get("points") || 1) };
      } else {
        body = { type: "GENERATED", topicId: topicId || undefined, promptTemplate: { text: "Generated linear equation" }, answerDefinition: { type: "NUMBER" }, generatorDefinition: { kind: "LINEAR_EQUATION", aMin: Number(form.get("aMin") || 1), aMax: Number(form.get("aMax") || 9), bMin: Number(form.get("bMin") || -20), bMax: Number(form.get("bMax") || 20), xMin: Number(form.get("xMin") || -10), xMax: Number(form.get("xMax") || 10) }, explanationContent: form.get("explanation") ? { text: String(form.get("explanation")) } : undefined, position, points: Number(form.get("points") || 1) };
      }
      await api(`/tests/${testId}/questions`, { method: "POST", body: JSON.stringify(body) }); onDone();
    } catch (err: any) { onError(err.message); }
  }
  return <form className="card compact-card stack test-question-form" onSubmit={submit}>
    <div className="row"><select className="select" style={{ maxWidth: 220 }} value={kind} onChange={e => setKind(e.target.value as any)}><option value="STATIC">Статичне</option><option value="GENERATED">Генероване</option></select>{kind === "GENERATED" && <select className="select" style={{ maxWidth: 260 }} value={generator} onChange={e => setGenerator(e.target.value)}><option value="ARITHMETIC">Арифметика</option><option value="LINEAR_EQUATION">Лінійне рівняння</option></select>}</div>
    {subjectId && <div className="field"><label>Тема (для «Моїх помилок»)</label><select className="select" value={topicId} onChange={e => setTopicId(e.target.value)}><option value="">Без теми</option>{topics.map(topic => <option value={topic.id} key={topic.id}>{topic.parent_name ? `${topic.parent_name} → ` : ""}{topic.name}</option>)}</select><div className="row"><input className="input" value={newTopic} onChange={e => setNewTopic(e.target.value)} placeholder="Швидко створити нову тему" /><button type="button" className="btn secondary" onClick={createTopic}>+ Тема</button></div></div>}
    {kind === "STATIC" ? <><div className="field"><label>Умова</label><input className="input" name="prompt" required /></div><div className="field"><label>Правильна відповідь</label><input className="input" name="answer" required /></div><label className="row"><input type="checkbox" name="numeric" /> Числова відповідь</label></> : generator === "ARITHMETIC" ? <div className="grid cols-3"><div className="field"><label>Від</label><input className="input" name="min" type="number" defaultValue="1" /></div><div className="field"><label>До</label><input className="input" name="max" type="number" defaultValue="100" /></div><div className="field"><label>Операція</label><select className="select" name="operation"><option value="ADD">Додавання</option><option value="SUB">Віднімання</option></select></div></div> : <div className="grid cols-3"><div className="field"><label>a min/max</label><div className="row"><input className="input" name="aMin" type="number" defaultValue="1" /><input className="input" name="aMax" type="number" defaultValue="9" /></div></div><div className="field"><label>b min/max</label><div className="row"><input className="input" name="bMin" type="number" defaultValue="-20" /><input className="input" name="bMax" type="number" defaultValue="20" /></div></div><div className="field"><label>x min/max</label><div className="row"><input className="input" name="xMin" type="number" defaultValue="-10" /><input className="input" name="xMax" type="number" defaultValue="10" /></div></div></div>}
    <div className="field"><label>Пояснення (для premium)</label><textarea className="textarea" name="explanation" rows={2} /></div><div className="field"><label>Бали</label><input className="input" name="points" type="number" min="1" defaultValue="1" /></div><button className="btn">Додати питання</button>
  </form>;
}
