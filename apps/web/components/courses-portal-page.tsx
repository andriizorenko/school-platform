"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { dateOnly, money } from "../lib/format";
import { PlatformShell } from "./platform-shell";

export function CoursesPortalPage({ role }: { role: "PARENT" | "STUDENT" }) {
  const [owned, setOwned] = useState<any[]>([]);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [family, setFamily] = useState<any>(null);
  const [purchaseCourseId, setPurchaseCourseId] = useState<string | null>(null);
  const [manageLicenseId, setManageLicenseId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const myCourses = await api<any[]>("/portal/courses");
      setOwned(myCourses);
      if (role === "PARENT") {
        const [catalogRows, familyData] = await Promise.all([
          api<any[]>("/courses"),
          api<any>("/parent/dashboard"),
        ]);
        setCatalog(catalogRows);
        setFamily(familyData);
      } else {
        setCatalog([]);
      }
      setError("");
    } catch (e: any) {
      setError(e.message ?? "Не вдалося завантажити курси");
    }
  }
  useEffect(() => { void load(); }, []);

  return <PlatformShell allowedRoles={[role]}>
    <div className="page-head courses-portal-head"><div><h1>Курси</h1><p className="muted">Самостійні курси, прогрес, тести та персональний банк помилок.</p></div></div>
    {error && <div className="error">{error}</div>}{message && <div className="success">{message}</div>}
    <section className="stack courses-portal-section"><div className="section-heading"><h2>Мої курси</h2><span className="muted">{owned.length ? `${owned.length} активн.` : ""}</span></div>
    <div className="grid cols-3 courses-grid">{owned.map(course => <div className="card course-card course-owned-card" key={course.course_enrollment_id}>
      <Link href={`/${role.toLowerCase()}/courses/${course.course_enrollment_id}`}>
        <span className="badge">до {dateOnly(course.ends_at)}</span><h2 style={{ marginTop: 10 }}>{course.title}</h2>{role === "PARENT" && <div className="muted">{course.last_name} {course.first_name}</div>}
        <div className="progress"><span style={{ width: `${course.lesson_count ? Math.round(course.completed_count / course.lesson_count * 100) : 0}%` }} /></div><div className="muted">{course.completed_count}/{course.lesson_count} уроків</div>
      </Link>
      {role === "PARENT" && <button className="btn secondary" style={{ marginTop: 12 }} onClick={() => setManageLicenseId(course.license_id)}>Доступ дітей</button>}
    </div>)}{!owned.length && <div className="card muted">Активних курсів ще немає.</div>}</div>

    {role === "PARENT" && <><h2 style={{ marginTop: 24 }}>Каталог</h2><div className="grid cols-3">{catalog.map(course => <div className="card" key={course.id}><h2>{course.title}</h2><p className="muted">{course.description}</p><div className="row" style={{ justifyContent: "space-between", marginTop: 14 }}><strong>{course.from_price_minor != null ? `від ${money(course.from_price_minor)}` : ""}</strong><button className="btn" onClick={() => setPurchaseCourseId(course.id)}>Обрати доступ</button></div></div>)}</div></>}

    {purchaseCourseId && family && <PurchaseCourseSheet courseId={purchaseCourseId} students={family.students ?? []} onClose={() => setPurchaseCourseId(null)} onDone={() => { setPurchaseCourseId(null); setMessage("Доступ до курсу надано"); void load(); }} onError={setError} />}
    {manageLicenseId && <LicenseAccessSheet licenseId={manageLicenseId} onClose={() => setManageLicenseId(null)} onChanged={() => { setMessage("Доступ дитини оновлено"); void load(); }} onError={setError} />}
  </PlatformShell>;
}

function PurchaseCourseSheet({ courseId, students, onClose, onDone, onError }: any) {
  const [detail, setDetail] = useState<any>(null);
  const [planId, setPlanId] = useState("");
  const [selected, setSelected] = useState<string[]>(students.length === 1 ? [students[0]?.id].filter(Boolean) : []);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<any>(`/courses/${courseId}`).then(data => { setDetail(data); setPlanId(data.plans?.[0]?.id ?? ""); }).catch((e: any) => onError(e.message)); }, [courseId]);
  const plan = detail?.plans?.find((item: any) => item.id === planId);
  function toggle(id: string) { setSelected((current: string[]) => current.includes(id) ? current.filter(item => item !== id) : [...current, id]); }
  async function submit(event: FormEvent) { event.preventDefault(); if (!plan || !selected.length) return; setBusy(true); try { await api(`/course-plans/${plan.id}/purchase/manual`, { method: "POST", body: JSON.stringify({ studentIds: selected, amountMinor: Number(plan.price_minor), paymentMethod: "CARD" }) }); onDone(); } catch (e: any) { onError(e.message); } finally { setBusy(false); } }
  return <div className="sheet-backdrop" onClick={onClose}><aside className="sheet course-purchase-sheet" onClick={e => e.stopPropagation()}><button className="sheet-close" onClick={onClose}>×</button><form className="stack management-sheet-body" onSubmit={submit}><div><h2>{detail?.course?.title ?? "Курс"}</h2><p className="muted">Оберіть строк доступу та дітей. Додавання інших дітей пізніше безкоштовне, але дата завершення ліцензії не змінюється.</p></div><div className="field"><label>План доступу</label><select className="select" value={planId} onChange={e => setPlanId(e.target.value)}>{detail?.plans?.filter((item: any) => item.is_active).map((item: any) => <option key={item.id} value={item.id}>{item.name} · {money(item.price_minor)} · {item.explanations_enabled ? "з поясненнями" : "без пояснень"}</option>)}</select></div><div className="field"><label>Діти</label><div className="stack">{students.map((student: any) => <label className="lesson-row" key={student.id}><span>{student.lastName ?? student.last_name} {student.firstName ?? student.first_name}</span><input type="checkbox" checked={selected.includes(student.id)} onChange={() => toggle(student.id)} /></label>)}</div></div>{plan && <div className="card compact-card"><strong>До сплати: {money(plan.price_minor)}</strong><div className="muted">{plan.access_type === "DURATION" ? `${plan.duration_months} міс.` : `до ${plan.fixed_expiry_date}`}</div></div>}<button className="btn" disabled={busy || !selected.length || !plan}>{busy ? "Оформлюємо…" : "Надати доступ"}</button><div className="muted form-note">Тестовий сценарій використовує внутрішню фіксацію оплати. Підключення зовнішнього платіжного провайдера перевіряється окремо.</div></form></aside></div>;
}

function LicenseAccessSheet({ licenseId, onClose, onChanged, onError }: any) {
  const [data, setData] = useState<any>(null);
  async function load() { try { setData(await api(`/course-licenses/${licenseId}`)); } catch (e: any) { onError(e.message); } }
  useEffect(() => { void load(); }, [licenseId]);
  async function grant(studentId: string) { try { await api(`/course-licenses/${licenseId}/students/${studentId}`, { method: "POST" }); await load(); onChanged(); } catch (e: any) { onError(e.message); } }
  return <div className="sheet-backdrop" onClick={onClose}><aside className="sheet" onClick={e => e.stopPropagation()}><button className="sheet-close" onClick={onClose}>×</button><div className="stack management-sheet-body"><div><h2>Доступ дітей</h2><p className="muted">{data?.license?.course_title}. Спільна дата завершення: {data?.license ? dateOnly(data.license.ends_at) : "…"}</p></div>{data?.students?.map((student: any) => <div className="lesson-row" key={student.id}><div><strong>{student.last_name} {student.first_name}</strong><div className="muted">{student.course_enrollment_id ? "Доступ уже надано" : "Ще без доступу"}</div></div>{student.course_enrollment_id ? <span className="badge paid">✓ Доступ</span> : <button className="btn" onClick={() => grant(student.id)}>Надати безкоштовно</button>}</div>)}</div></aside></div>;
}
