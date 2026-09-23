"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, type Me } from "../lib/api";
import { dateOnly, dateTime, money } from "../lib/format";
import { PlatformShell } from "./platform-shell";
import { TeacherAvailabilityEditor } from "./teacher-availability-editor";

type Tab = "overview" | "students" | "availability" | "payroll" | "access" | "history";

export function TeacherDetailPage({ role, teacherId }: { role: "ADMIN" | "MANAGER"; teacherId: string }) {
  const [me, setMe] = useState<Me | null>(null);
  const [teacher, setTeacher] = useState<any>(null);
  const [rates, setRates] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [payoutDetails, setPayoutDetails] = useState<any>(null);
  const [statement, setStatement] = useState<any>(null);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [zoomUrl, setZoomUrl] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [newSubjectId, setNewSubjectId] = useState("");
  const [rateSubjectId, setRateSubjectId] = useState("");
  const [rateValue, setRateValue] = useState("200");
  const [rateFrom, setRateFrom] = useState(new Date().toISOString().slice(0, 10));
  const [suspensionReason, setSuspensionReason] = useState("");
  const [payoutType, setPayoutType] = useState("CARD");
  const [payoutDetailsText, setPayoutDetailsText] = useState("");
  const [payoutMasked, setPayoutMasked] = useState("");

  const isAdmin = me?.roles.includes("ADMIN") ?? false;
  const isSupport = me?.roles.includes("SUPPORT_MANAGER") ?? false;
  const canManageTeacher = me?.permissions.includes("teacher.manage") ?? false;
  const canManageRates = me?.permissions.includes("teacher.rate.manage") ?? false;
  const canViewPayroll = me?.permissions.includes("payroll.view") ?? false;
  const canManagePayoutDetails = me?.permissions.includes("payroll.details.manage") ?? false;
  const canSuspend = me?.permissions.includes("user.suspend") ?? false;
  const canInvite = me?.permissions.includes("user.invite") ?? false;
  const canAudit = me?.permissions.includes("audit.view") ?? false;

  async function load() {
    try {
      const meResult = await api<{ user: Me }>("/auth/me");
      const user = meResult.user;
      setMe(user);
      const [t, st, sub] = await Promise.all([
        api<any>(`/teachers/${teacherId}`),
        api<any[]>(`/ops/students?teacher=${teacherId}&lifecycle=ALL`).catch(() => []),
        api<any[]>("/subjects"),
      ]);
      setTeacher(t);
      setStudents(st);
      setSubjects(sub);
      setFirstName(t.firstName ?? "");
      setLastName(t.lastName ?? "");
      setPhone(t.phone ?? "");
      setZoomUrl(t.zoomUrl ?? "");
      setStartedAt(t.startedAt?.slice(0, 10) ?? "");
      setNewSubjectId(sub.find((item: any) => !t.subjects?.some((linked: any) => linked.id === item.id))?.id ?? "");
      setRateSubjectId(t.subjects?.find((item: any) => item.isActive)?.id ?? "");

      if (user.permissions.includes("teacher.rate.view")) {
        setRates(await api<any[]>(`/teachers/${teacherId}/rates`).catch(() => []));
      } else {
        setRates([]);
      }
      if (user.permissions.includes("payroll.details.manage")) {
        const details = await api<any>(`/payroll/teachers/${teacherId}/details`).catch(() => null);
        setPayoutDetails(details);
        setPayoutType(details?.destinationType ?? "CARD");
        setPayoutDetailsText(details?.details ?? "");
        setPayoutMasked(details?.maskedDisplay ?? "");
      }
      if (user.permissions.includes("payroll.view")) {
        const [statementResult, payoutRows] = await Promise.all([
          api<any>(`/payroll/teachers/${teacherId}/statement`).catch(() => null),
          api<any[]>(`/payroll/teachers/${teacherId}/payouts`).catch(() => []),
        ]);
        setStatement(statementResult);
        setPayouts(payoutRows);
      }
      if (user.permissions.includes("audit.view")) {
        setHistory(await api<any[]>(`/teachers/${teacherId}/history?limit=100`).catch(() => []));
      }
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    void load();
  }, [teacherId]);

  const tabs = useMemo(() => {
    const items: Array<{ id: Tab; label: string }> = [
      { id: "overview", label: "Огляд" },
      { id: "students", label: "Учні" },
      { id: "availability", label: "Вільні години" },
    ];
    if (canViewPayroll) items.push({ id: "payroll", label: "Виплати" });
    if (canManageTeacher || canSuspend || canInvite) items.push({ id: "access", label: "Доступ" });
    if (canAudit) items.push({ id: "history", label: "Історія" });
    return items;
  }, [canViewPayroll, canManageTeacher, canSuspend, canInvite, canAudit]);

  async function saveTeacher(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/teachers/${teacherId}`, {
        method: "PATCH",
        body: JSON.stringify({ firstName, lastName, phone, zoomUrl: zoomUrl || undefined, startedAt: startedAt || undefined }),
      });
      setMessage("Профіль викладача оновлено.");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function addSubject() {
    if (!newSubjectId) return;
    try {
      await api(`/teachers/${teacherId}/subjects`, { method: "POST", body: JSON.stringify({ subjectId: newSubjectId }) });
      setMessage("Предмет додано.");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function toggleSubject(subjectId: string, active: boolean) {
    try {
      await api(`/teachers/${teacherId}/subjects/${subjectId}`, { method: "PATCH", body: JSON.stringify({ active }) });
      setMessage(active ? "Предмет активовано." : "Предмет вимкнено.");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function addRate(e: FormEvent) {
    e.preventDefault();
    if (!rateSubjectId) return;
    try {
      await api(`/teachers/${teacherId}/subjects/${rateSubjectId}/rates`, {
        method: "POST",
        body: JSON.stringify({ rate60Minor: Math.round(Number(rateValue) * 100), effectiveFrom: rateFrom }),
      });
      setMessage("Нову ставку збережено.");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function invite() {
    try {
      await api(`/users/${teacherId}/invite`, { method: "POST" });
      setMessage("Запрошення відправлено.");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function suspend() {
    if (!suspensionReason.trim()) return;
    try {
      await api(`/users/${teacherId}/suspend`, { method: "POST", body: JSON.stringify({ reason: suspensionReason.trim() }) });
      setMessage("Акаунт викладача заблоковано.");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function restore() {
    try {
      await api(`/users/${teacherId}/restore`, { method: "POST" });
      setMessage("Акаунт викладача розблоковано.");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function archive() {
    try {
      await api(`/teachers/${teacherId}/archive`, { method: "POST" });
      setMessage("Викладача перенесено в архів.");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function reactivate() {
    try {
      await api(`/teachers/${teacherId}/reactivate`, { method: "POST" });
      setMessage("Викладача відновлено.");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function savePayoutDetails(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/payroll/teachers/${teacherId}/details`, {
        method: "PUT",
        body: JSON.stringify({ destinationType: payoutType, details: payoutDetailsText, maskedDisplay: payoutMasked }),
      });
      setMessage("Реквізити виплат оновлено.");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  const currentRateFor = (subjectId: string) => rates.filter((rate) => rate.subjectId === subjectId).at(-1);
  const availableSubjects = subjects.filter((subject) => !teacher?.subjects?.some((linked: any) => linked.id === subject.id && linked.isActive));

  return (
    <PlatformShell allowedRoles={role === "ADMIN" ? ["ADMIN", "SUPPORT_MANAGER"] : ["MANAGER"]}>
      <div className="page-head">
        <div>
          <h1>{teacher ? `${teacher.lastName} ${teacher.firstName}` : "Викладач"}</h1>
          <p className="muted">{teacher?.email} · {teacher?.phone}</p>
        </div>
        <div className="row">
          <span className={`badge ${teacher?.teacherStatus === "ACTIVE" ? "paid" : "booked"}`}>{teacher?.teacherStatus}</span>
          <span className={`badge ${teacher?.userStatus === "ACTIVE" ? "paid" : "booked"}`}>{teacher?.userStatus}</span>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}

      <div className="row" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        {tabs.map((item) => <button key={item.id} className={`btn ${tab === item.id ? "" : "secondary"}`} onClick={() => setTab(item.id)}>{item.label}</button>)}
      </div>

      {tab === "overview" && (
        <div className="stack">
          <div className="grid cols-4">
            <div className="card"><div className="muted">Активні учні</div><div className="metric">{teacher?.summary?.activeStudents ?? 0}</div></div>
            <div className="card"><div className="muted">Колишні учні</div><div className="metric">{teacher?.summary?.formerStudents ?? 0}</div></div>
            <div className="card"><div className="muted">Майбутні уроки</div><div className="metric">{teacher?.summary?.futureSessions ?? 0}</div></div>
            <div className="card"><div className="muted">Запити на відпустку</div><div className="metric">{teacher?.summary?.pendingVacations ?? 0}</div></div>
          </div>

          <div className="grid cols-2">
            <section className="card stack">
              <h2>Профіль</h2>
              {canManageTeacher ? (
                <form className="stack" onSubmit={saveTeacher}>
                  <div className="grid cols-2">
                    <div className="field"><label>Імʼя</label><input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div>
                    <div className="field"><label>Прізвище</label><input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
                    <div className="field"><label>Телефон</label><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
                    <div className="field"><label>Працює з</label><input className="input" type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} /></div>
                  </div>
                  <div className="field"><label>Постійне Zoom-посилання</label><input className="input" type="url" value={zoomUrl} onChange={(e) => setZoomUrl(e.target.value)} placeholder="https://zoom.us/..." /></div>
                  <button className="btn secondary">Зберегти профіль</button>
                </form>
              ) : (
                <div className="stack"><div><strong>Телефон:</strong> {teacher?.phone}</div><div><strong>Працює з:</strong> {teacher?.startedAt ? dateOnly(teacher.startedAt) : "—"}</div>{teacher?.zoomUrl && <a className="btn secondary" href={teacher.zoomUrl} target="_blank">Відкрити Zoom</a>}</div>
              )}
            </section>

            <section className="card stack">
              <h2>Предмети</h2>
              {(teacher?.subjects ?? []).map((subject: any) => {
                const rate = currentRateFor(subject.id);
                return <div className="session-row" key={subject.id}>
                  <div><strong>{subject.name}</strong><div className="muted">{subject.isActive ? "Активний предмет" : "Вимкнений"}{canManageRates && rate ? ` · ${money(rate.rate60Minor, rate.currency)} / 60 хв` : ""}</div></div>
                  {canManageTeacher && <button className="btn secondary" onClick={() => void toggleSubject(subject.id, !subject.isActive)}>{subject.isActive ? "Вимкнути" : "Активувати"}</button>}
                </div>;
              })}
              {canManageTeacher && availableSubjects.length > 0 && <div className="row"><select className="select" value={newSubjectId} onChange={(e) => setNewSubjectId(e.target.value)}>{availableSubjects.map((subject: any) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select><button className="btn secondary" onClick={addSubject}>+ Предмет</button></div>}
            </section>
          </div>

          {canManageRates && (
            <section className="card stack">
              <h2>Ставки викладача</h2>
              <div className="table-wrap"><table><thead><tr><th>Предмет</th><th>60 хв</th><th>Діє з</th><th>До</th></tr></thead><tbody>{rates.map((rate) => <tr key={rate.rateId}><td>{rate.subjectName}</td><td>{money(rate.rate60Minor, rate.currency)}</td><td>{rate.effectiveFrom}</td><td>{rate.effectiveUntil ?? "далі"}</td></tr>)}</tbody></table></div>
              <form className="grid cols-3" onSubmit={addRate}>
                <div className="field"><label>Предмет</label><select className="select" value={rateSubjectId} onChange={(e) => setRateSubjectId(e.target.value)}>{teacher?.subjects?.filter((subject: any) => subject.isActive).map((subject: any) => <option value={subject.id} key={subject.id}>{subject.name}</option>)}</select></div>
                <div className="field"><label>Ставка за 60 хв, грн</label><input className="input" type="number" min="0" step="0.01" value={rateValue} onChange={(e) => setRateValue(e.target.value)} /></div>
                <div className="field"><label>Діє з</label><input className="input" type="date" value={rateFrom} onChange={(e) => setRateFrom(e.target.value)} /></div>
                <button className="btn">Додати нову ставку</button>
              </form>
            </section>
          )}
        </div>
      )}

      {tab === "students" && (
        <div className="grid cols-3">
          {students.map((student: any) => <div className="card" key={student.id}><strong>{student.last_name} {student.first_name}</strong><div className="muted">{student.grade_level ? `${student.grade_level} клас` : ""}</div>{(student.enrollments ?? []).filter((enrollment: any) => enrollment.teacherId === teacherId || enrollment.teacher_id === teacherId).map((enrollment: any) => <div key={enrollment.id}>{enrollment.subjectName} · {enrollment.balanceLessonUnits} зан.</div>)}</div>)}
          {!students.length && <div className="empty">Учнів не знайдено.</div>}
        </div>
      )}

      {tab === "availability" && <TeacherAvailabilityEditor teacherId={teacherId} title="Вільні години викладача" />}

      {tab === "payroll" && canViewPayroll && (
        <div className="stack">
          <section className="card stack">
            <h2>Історія виплат</h2>
            <div className="table-wrap"><table><thead><tr><th>Період</th><th>Сума</th><th>Куди</th><th>Статус</th></tr></thead><tbody>{payouts.map((payout: any) => <tr key={payout.id}><td>{dateOnly(payout.period_start)} — {dateOnly(payout.period_end)}</td><td>{money(payout.amount_snapshot_minor, payout.currency)}</td><td>{payout.payout_destination_masked ?? "—"}</td><td><span className={`badge ${payout.status === "PAID" ? "paid" : "booked"}`}>{payout.status}</span></td></tr>)}</tbody></table></div>
            {!payouts.length && <div className="empty compact-empty">Виплат ще немає.</div>}
          </section>
          <section className="card stack">
            <h2>Нарахування</h2>
            <div className="metric">{money(statement?.totalMinor ?? 0)}</div>
            <div className="muted">Сума за завантажену історію нарахувань.</div>
            <div className="table-wrap"><table><thead><tr><th>Дата</th><th>Учень</th><th>Предмет</th><th>Тип</th><th>Сума</th></tr></thead><tbody>{(statement?.items ?? []).slice(0, 30).map((item: any) => <tr key={item.id}><td>{item.earned_for_date}</td><td>{item.student_last_name} {item.student_first_name}</td><td>{item.subject_name}</td><td>{item.type}</td><td>{money(item.amount_minor)}</td></tr>)}</tbody></table></div>
          </section>
          {canManagePayoutDetails && (
            <form className="card stack" onSubmit={savePayoutDetails}>
              <h2>Реквізити виплати</h2>
              {payoutDetails?.createdAt && <div className="muted">Останнє оновлення: {dateTime(payoutDetails.createdAt)}</div>}
              <div className="grid cols-2">
                <div className="field"><label>Тип</label><input className="input" value={payoutType} onChange={(e) => setPayoutType(e.target.value)} /></div>
                <div className="field"><label>Маскований вигляд</label><input className="input" value={payoutMasked} onChange={(e) => setPayoutMasked(e.target.value)} placeholder="•••• 4821" /></div>
              </div>
              <div className="field"><label>Повні реквізити</label><textarea className="input" rows={4} value={payoutDetailsText} onChange={(e) => setPayoutDetailsText(e.target.value)} /></div>
              <button className="btn secondary">Оновити реквізити</button>
            </form>
          )}
        </div>
      )}

      {tab === "access" && (
        <div className="grid cols-2">
          <section className="card stack">
            <h2>Акаунт</h2>
            <div><strong>{teacher?.email}</strong></div>
            <div className="row"><span className="badge">{teacher?.userStatus}</span><span className="badge">{teacher?.teacherStatus}</span></div>
            {teacher?.latestInvitation?.created_at && <div className="muted">Останнє запрошення: {dateTime(teacher.latestInvitation.created_at)}{teacher.latestInvitation.accepted_at ? " · прийнято" : ""}</div>}
            {canInvite && teacher?.userStatus === "PENDING" && <button className="btn secondary" onClick={invite}>Надіслати запрошення ще раз</button>}
            {canSuspend && teacher?.userStatus === "ACTIVE" && <><div className="field"><label>Причина блокування</label><input className="input" value={suspensionReason} onChange={(e) => setSuspensionReason(e.target.value)} /></div><button className="btn secondary" onClick={suspend} disabled={!suspensionReason.trim()}>Заблокувати акаунт</button></>}
            {canSuspend && teacher?.userStatus === "SUSPENDED" && <button className="btn" onClick={restore}>Розблокувати акаунт</button>}
            {canManageTeacher && teacher?.teacherStatus !== "ARCHIVED" && teacher?.userStatus !== "SUSPENDED" && <button className="btn secondary" onClick={archive}>Архівувати викладача</button>}
            {canManageTeacher && teacher?.teacherStatus === "ARCHIVED" && <button className="btn" onClick={reactivate}>Відновити з архіву</button>}
          </section>
          <section className="card stack">
            <h2>Тимчасові права</h2>
            {(teacher?.temporaryPermissions ?? []).map((grant: any, index: number) => <div className="session-row" key={`${grant.permission_code}-${index}`}><div><strong>{grant.permission_code}</strong><div className="muted">{grant.scope_type} · до {dateTime(grant.expires_at)}</div></div></div>)}
            {!teacher?.temporaryPermissions?.length && <div className="empty compact-empty">Активних тимчасових прав немає.</div>}
          </section>
        </div>
      )}

      {tab === "history" && canAudit && (
        <div className="table-wrap"><table><thead><tr><th>Час</th><th>Хто</th><th>Дія</th><th>Зміни</th></tr></thead><tbody>{history.map((item) => <tr key={item.id}><td>{dateTime(item.created_at)}</td><td>{item.actor_name}<br /><span className="muted">{item.actor_role_code}</span></td><td><strong>{item.action}</strong></td><td><details><summary>Переглянути</summary><pre className="audit-json">{JSON.stringify({ before: item.before_data, after: item.after_data }, null, 2)}</pre></details></td></tr>)}</tbody></table></div>
      )}
    </PlatformShell>
  );
}
