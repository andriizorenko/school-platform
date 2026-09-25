"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { dateTime, money } from "../lib/format";
import { ErrorCard, LoadingCard } from "./loadable";
import { PlatformShell } from "./platform-shell";

type Role = "ADMIN" | "MANAGER";

function studentHref(role: Role, studentId: string) {
  return role === "ADMIN" ? `/admin/students/${studentId}` : `/manager/students/${studentId}`;
}

function purchaseTitle(item: any) {
  if (item.productType === "LESSON_TOPUP") return `${item.studentLastName ?? ""} ${item.studentFirstName ?? ""} · ${item.subjectName ?? "Предмет"} · +${item.lessonUnits} занять`;
  if (item.productType === "FIRST_LESSON") return `${item.studentLastName ?? ""} ${item.studentFirstName ?? ""} · ${item.subjectName ?? "Предмет"} · перше заняття`;
  if (item.productType === "COURSE") return `Курс · ${item.courseTitle ?? "—"}`;
  return "Інша операція";
}

function invitationText(data: any) {
  if (data.parentPasswordConfigured) return "Акаунт активований";
  if (!data.parentLastInvitationAt) return "Запрошення ще не надсилалось";
  if (data.parentLastInvitationAcceptedAt) return "Запрошення прийнято";
  return `Надіслано ${dateTime(data.parentLastInvitationAt)} · діє до ${dateTime(data.parentLastInvitationExpiresAt)}`;
}

export function FamilyOperationsPage({ familyId, role }: { familyId: string; role: Role }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const [addingChild, setAddingChild] = useState(false);
  const [childForm, setChildForm] = useState({ firstName: "", lastName: "", gradeLevel: "" });
  const [parentForm, setParentForm] = useState({ firstName: "", lastName: "", phone: "", email: "" });

  async function load() {
    setLoading(true); setError(null);
    try {
      const next = await api<any>(`/families/${familyId}/operations-overview`);
      setData(next);
      setParentForm({
        firstName: next.family.parentFirstName ?? "",
        lastName: next.family.parentLastName ?? "",
        phone: next.family.parentPhone ?? "",
        email: next.family.parentEmail ?? "",
      });
    } catch (value) { setError(value as Error); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [familyId]);

  async function saveParent(event: FormEvent) {
    event.preventDefault(); setBusy("parent"); setMessage("");
    try {
      await api(`/families/${familyId}/parent`, { method: "PATCH", body: JSON.stringify(parentForm) });
      setEditing(false); setMessage("Контактні дані батьків оновлено."); await load();
    } catch (value: any) { setMessage(value.message ?? "Не вдалося оновити профіль"); }
    finally { setBusy(""); }
  }

  async function invite(userId: string) {
    setBusy(`invite:${userId}`); setMessage("");
    try { await api(`/users/${userId}/invite`, { method: "POST" }); setMessage("Запрошення надіслано на email."); await load(); }
    catch (value: any) { setMessage(value.message ?? "Не вдалося надіслати запрошення"); }
    finally { setBusy(""); }
  }

  async function createChild(event: FormEvent) {
    event.preventDefault(); setBusy("child"); setMessage("");
    try {
      const child = await api<any>(`/families/${familyId}/students`, {
        method: "POST",
        body: JSON.stringify({
          firstName: childForm.firstName.trim(),
          lastName: childForm.lastName.trim(),
          gradeLevel: childForm.gradeLevel ? Number(childForm.gradeLevel) : undefined,
        }),
      });
      if (role === "MANAGER") {
        const current = await api<any>("/auth/me");
        if (current?.user?.id) {
          await api(`/students/${child.id}/primary-manager`, {
            method: "POST",
            body: JSON.stringify({ managerUserId: current.user.id }),
          });
        }
      }
      setChildForm({ firstName: "", lastName: "", gradeLevel: "" });
      setAddingChild(false);
      setMessage("Дитину додано до сімʼї.");
      await load();
    } catch (value: any) {
      setMessage(value.message ?? "Не вдалося додати дитину");
    } finally {
      setBusy("");
    }
  }

  async function archiveFamily() {
    setBusy("archive"); setMessage("");
    try {
      await api(`/families/${familyId}/archive`, { method: "POST", body: JSON.stringify({ reason: archiveReason || undefined }) });
      setArchiveReason(""); setMessage("Сімʼю перенесено в архів."); await load();
    } catch (value: any) { setMessage(value.message ?? "Не вдалося архівувати сімʼю"); }
    finally { setBusy(""); }
  }

  async function reactivateFamily() {
    setBusy("reactivate"); setMessage("");
    try { await api(`/families/${familyId}/reactivate`, { method: "POST" }); setMessage("Сімʼю відновлено з архіву."); await load(); }
    catch (value: any) { setMessage(value.message ?? "Не вдалося відновити сімʼю"); }
    finally { setBusy(""); }
  }

  const revenue = useMemo(() => data?.purchases?.filter((item:any) => item.status === "PAID").reduce((sum:number, item:any) => sum + Number(item.totalMinor ?? 0), 0) ?? 0, [data]);
  const allowedRoles = role === "ADMIN" ? ["ADMIN", "SUPPORT_MANAGER"] : ["MANAGER"];

  return <PlatformShell allowedRoles={allowedRoles}>
    {loading ? <LoadingCard /> : error ? <ErrorCard error={error} /> : data && <div className="stack family-operations-page">
      <div className="page-head">
        <div>
          <div className="row"><h1>Сім’я {data.family.parentLastName || ""}</h1><span className={`badge ${data.status === "ACTIVE" ? "success" : ""}`}>{data.status}</span></div>
          <p className="muted">Єдина сімейна картка: діти, акаунти, предмети, баланси, покупки, курси та історія.</p>
        </div>
        <div className="row wrap-row"><Link className="btn secondary" href={role === "ADMIN" ? "/admin/families" : "/manager/families"}>← Сімʼї</Link></div>
      </div>
      {message && <div className={message.includes("не вдалося") || message.includes("Не вдалося") ? "error" : "success"}>{message}</div>}

      <div className="grid cols-4 family-summary-grid">
        <div className="card"><div className="muted">Діти</div><div className="metric">{data.summary.children}</div></div>
        <div className="card"><div className="muted">Активні предмети</div><div className="metric">{data.summary.activeEnrollments}</div></div>
        <div className="card"><div className="muted">Баланс сім’ї</div><div className="metric">{data.summary.totalBalanceLessonUnits}</div><div className="muted">занять сумарно</div></div>
        <div className="card"><div className="muted">Зафіксовано оплат</div><div className="metric family-money-metric">{money(revenue)}</div><div className="muted">усі покупки</div></div>
      </div>

      <div className="grid cols-2">
        <div className="card family-parent-card stack">
          <div className="page-head compact-page-head"><h2>Батьківський акаунт</h2><button className="btn secondary" onClick={() => setEditing((value) => !value)}>{editing ? "Скасувати" : "Редагувати"}</button></div>
          {!editing ? <>
            <strong>{data.family.parentLastName} {data.family.parentFirstName}</strong>
            <div>{data.family.parentPhone}</div><div>{data.family.parentEmail}</div>
            <div className="row wrap-row"><span className="badge">{data.family.parentAccountStatus}</span><span className="muted">{invitationText(data.family)}</span></div>
            {!data.family.parentPasswordConfigured && !data.family.archivedAt && <button className="btn secondary" disabled={busy === `invite:${data.family.parentUserId}`} onClick={() => invite(data.family.parentUserId)}>{data.family.parentLastInvitationAt ? "Надіслати запрошення повторно" : "Надіслати запрошення"}</button>}
          </> : <form className="stack" onSubmit={saveParent}>
            <div className="grid cols-2"><div className="field"><label>Імʼя</label><input className="input" required value={parentForm.firstName} onChange={(event) => setParentForm({ ...parentForm, firstName: event.target.value })}/></div><div className="field"><label>Прізвище</label><input className="input" required value={parentForm.lastName} onChange={(event) => setParentForm({ ...parentForm, lastName: event.target.value })}/></div></div>
            <div className="field"><label>Телефон</label><input className="input" required value={parentForm.phone} onChange={(event) => setParentForm({ ...parentForm, phone: event.target.value })}/></div>
            <div className="field"><label>Email акаунта</label><input className="input" type="email" required value={parentForm.email} onChange={(event) => setParentForm({ ...parentForm, email: event.target.value })}/></div>
            <button className="btn" disabled={busy === "parent"}>Зберегти</button>
          </form>}
        </div>
        <div className="card stack">
          <h2>Життєвий цикл сімʼї</h2>
          {data.family.archivedAt ? <><div><span className="badge">ARCHIVED</span> <span className="muted">з {dateTime(data.family.archivedAt)}</span></div>{data.family.archiveReason && <p>{data.family.archiveReason}</p>}<button className="btn" disabled={busy === "reactivate"} onClick={reactivateFamily}>Відновити сімʼю</button></> : <><p className="muted">Сімʼю можна архівувати лише після архівації всіх дітей та завершення активних доступів до курсів.</p><textarea className="input" rows={3} placeholder="Причина (необовʼязково)" value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)}/><button className="btn secondary" disabled={busy === "archive"} onClick={archiveFamily}>Архівувати сімʼю</button></>}
        </div>
      </div>

      <section className="stack">
        <div className="page-head compact-page-head">
          <h2>Діти та навчання</h2>
          {!data.family.archivedAt && <button className="btn secondary" onClick={() => { setMessage(""); setAddingChild(true); }}>+ Додати дитину</button>}
        </div>
        <div className="family-children-grid">{data.children.map((child:any) => <article className="card family-child-card" key={child.id}>
          <div className="page-head compact-page-head"><div><h3>{child.lastName} {child.firstName}</h3><div className="muted">{child.gradeLevel ? `${child.gradeLevel} клас` : "Клас не вказано"} · {child.archivedAt ? "архів" : child.userId ? "має учнівський акаунт" : "без окремого акаунта"}</div></div><Link className="btn secondary" href={studentHref(role,child.id)}>Відкрити учня</Link></div>
          <div className="row wrap-row"><span className="muted">Primary manager: <strong>{child.managerUserId ? `${child.managerLastName} ${child.managerFirstName}` : "не призначено"}</strong></span>{child.accountStatus && <span className="badge">{child.accountStatus}</span>}</div>
          {child.userId && !child.passwordConfigured && !child.archivedAt && <button className="btn secondary" disabled={busy === `invite:${child.userId}`} onClick={() => invite(child.userId)}>{child.lastInvitationAt ? "Повторити запрошення дитині" : "Запросити дитину"}</button>}
          <div className="family-enrollment-list">{child.enrollments?.map((enrollment:any) => <div className="family-enrollment-row" key={enrollment.id}><div><strong>{enrollment.subjectName}</strong><div className="muted">{enrollment.teacherId ? `${enrollment.teacherLastName} ${enrollment.teacherFirstName}` : "Викладач не призначений"}</div></div><div className="family-enrollment-balance"><strong>{enrollment.balanceLessonUnits}</strong><span className="muted">занять</span></div><span className="badge">{enrollment.status}</span></div>)}{!child.enrollments?.length && <div className="empty-inline">Предметів ще немає.</div>}</div>
        </article>)}</div>
      </section>

      <section className="stack"><h2>Покупки сім’ї</h2><div className="table-wrap"><table><thead><tr><th>Дата</th><th>Що придбано</th><th>Сума</th><th>Метод</th><th>Статус</th></tr></thead><tbody>{data.purchases.map((item:any) => <tr key={item.id}><td>{dateTime(item.paidAt ?? item.createdAt)}</td><td>{purchaseTitle(item)}</td><td><strong>{money(item.totalMinor,item.currency)}</strong>{Number(item.discountMinor)>0 && <div className="muted">знижка {money(item.discountMinor,item.currency)}</div>}</td><td>{item.paymentMethod ?? item.source}</td><td><span className="badge">{item.status}</span></td></tr>)}</tbody></table></div>{!data.purchases.length && <div className="card muted">Покупок ще немає.</div>}</section>

      {!!data.courses.length && <section className="stack"><h2>Сімейні доступи до курсів</h2><div className="grid cols-2">{data.courses.map((course:any) => <div className="card" key={course.id}><div className="page-head compact-page-head"><div><strong>{course.courseTitle}</strong><div className="muted">до {dateTime(course.endsAt)}</div></div><span className="badge">{course.status}</span></div><div className="row wrap-row">{course.students?.map((student:any) => <span className="badge" key={student.studentId}>{student.lastName} {student.firstName}</span>)}</div></div>)}</div></section>}

      {addingChild && <div className="sheet-backdrop" onClick={() => busy !== "child" && setAddingChild(false)}>
        <aside className="sheet" onClick={(event) => event.stopPropagation()}>
          <button className="sheet-close" onClick={() => busy !== "child" && setAddingChild(false)}>×</button>
          <form className="stack management-sheet-body" style={{ marginTop: 40 }} onSubmit={createChild}>
            <div><h2>Додати дитину до сімʼї</h2><p className="muted">Батьківський акаунт залишиться спільним. Предмети можна додати після створення дитини.</p></div>
            <div className="field"><label>Імʼя *</label><input className="input" required value={childForm.firstName} onChange={(event) => setChildForm({ ...childForm, firstName: event.target.value })} /></div>
            <div className="field"><label>Прізвище *</label><input className="input" required value={childForm.lastName} onChange={(event) => setChildForm({ ...childForm, lastName: event.target.value })} /></div>
            <div className="field"><label>Клас</label><input className="input" type="number" min="1" max="12" value={childForm.gradeLevel} onChange={(event) => setChildForm({ ...childForm, gradeLevel: event.target.value })} /></div>
            <button className="btn" disabled={busy === "child"}>{busy === "child" ? "Додаємо…" : "Додати дитину"}</button>
          </form>
        </aside>
      </div>}

      <details className="card history-disclosure"><summary><strong>Останні значущі події сім’ї</strong><span className="muted">{data.activity.length}</span></summary><div className="history-body history-list">{data.activity.map((event:any) => <div className="history-list-row" key={event.id}><div className="row"><strong>{event.action}</strong><span className="badge">{event.entityType}</span></div><div className="muted">{dateTime(event.createdAt)} · {event.actorName}{event.actorRole ? ` · ${event.actorRole}` : ""}</div></div>)}</div></details>
    </div>}
  </PlatformShell>;
}
