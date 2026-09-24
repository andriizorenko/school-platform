"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { money } from "../lib/format";
import { PlatformShell } from "./platform-shell";

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-zа-яіїєґ0-9]+/gi, "-").replace(/^-|-$/g, "");
}

export function AdminCoursesPage() {
  const [courses, setCourses] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const [courseRows, subjectRows] = await Promise.all([api<any[]>("/courses"), api<any[]>("/subjects")]);
      setCourses(courseRows);
      setSubjects(subjectRows);
    } catch (e: any) { setError(e.message); }
  }
  useEffect(() => { void load(); }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const course = await api<any>("/courses", {
        method: "POST",
        body: JSON.stringify({ title, slug: slug || slugify(title), description: description || undefined, subjectId: subjectId || undefined }),
      });
      location.href = `/admin/courses/${course.id}`;
    } catch (e: any) { setError(e.message); }
  }

  return <PlatformShell allowedRoles={["ADMIN"]}>
    <div className="page-head">
      <div><h1>Курси</h1><p className="muted">Конструктор курсів для самостійного навчання, тестів, PDF-матеріалів і планів доступу.</p></div>
      <button className="btn" onClick={() => setShowCreate(v => !v)}>{showCreate ? "Закрити" : "+ Створити курс"}</button>
    </div>
    {error && <div className="error">{error}</div>}
    {showCreate && <form className="card course-create-form" onSubmit={create}>
      <div className="grid cols-2">
        <div className="field"><label>Назва</label><input className="input" value={title} onChange={e => { setTitle(e.target.value); if (!slug) setSlug(slugify(e.target.value)); }} required /></div>
        <div className="field"><label>Адреса курсу (slug)</label><input className="input" value={slug} onChange={e => setSlug(slugify(e.target.value))} required /></div>
        <div className="field"><label>Предмет</label><select className="select" value={subjectId} onChange={e => setSubjectId(e.target.value)}><option value="">Без предмета</option>{subjects.map(subject => <option value={subject.id} key={subject.id}>{subject.name}</option>)}</select></div>
        <div className="field"><label>Опис</label><input className="input" value={description} onChange={e => setDescription(e.target.value)} /></div>
      </div>
      <div className="row" style={{ marginTop: 14 }}><button className="btn" type="submit">Створити й відкрити конструктор</button></div>
    </form>}
    <div className="table-wrap" style={{ marginTop: 18 }}><table><thead><tr><th>Курс</th><th>Статус</th><th>Предмет</th><th>Модулів</th><th>Уроків</th><th>Ціна від</th></tr></thead><tbody>
      {courses.map(course => <tr key={course.id}>
        <td><Link className="link-button" href={`/admin/courses/${course.id}`}><strong>{course.title}</strong></Link></td>
        <td><span className="badge">{course.status}</span></td><td>{course.subject_name || "—"}</td><td>{course.module_count}</td><td>{course.lesson_count ?? 0}</td><td>{course.from_price_minor != null ? money(course.from_price_minor) : "—"}</td>
      </tr>)}
      {!courses.length && <tr><td colSpan={6}><div className="empty">Курсів ще немає.</div></td></tr>}
    </tbody></table></div>
  </PlatformShell>;
}
