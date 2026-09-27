"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, type Me } from "../lib/api";
import { dateOnly, dateTime } from "../lib/format";
import { PlatformShell } from "./platform-shell";

type PastRescheduleAccess = {
  eligible: boolean;
  enabled: boolean;
  startsAt?: string | null;
  expiresAt?: string | null;
};

type StaffRow = {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  startedAt: string;
  archivedAt?: string | null;
  userStatus: "PENDING" | "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  roles: string[];
  activeManagedStudents: number;
  lastInvitedAt?: string | null;
  lastInviteAcceptedAt?: string | null;
};

const roleLabel: Record<string, string> = {
  ADMIN: "Admin",
  MANAGER: "Менеджер",
  FINANCIER: "Фінансист",
  SUPPORT_MANAGER: "Техпідтримка",
};

function localDateTimeInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function defaultPastAccessExpiry() {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  date.setSeconds(0, 0);
  return localDateTimeInput(date);
}

const statusLabel: Record<string, string> = {
  PENDING: "Очікує активації",
  ACTIVE: "Активний",
  SUSPENDED: "Заблокований",
  ARCHIVED: "Архів",
};

export function TeamPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [selected, setSelected] = useState<StaffRow | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [showCreate, setShowCreate] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [roleCode, setRole] = useState("MANAGER");
  const [email, setEmail] = useState("");
  const [firstName, setFirst] = useState("");
  const [lastName, setLast] = useState("");
  const [phone, setPhone] = useState("");

  const [editFirst, setEditFirst] = useState("");
  const [editLast, setEditLast] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editStartedAt, setEditStartedAt] = useState("");
  const [editRole, setEditRole] = useState("MANAGER");
  const [suspensionReason, setSuspensionReason] = useState("");
  const [pastAccess, setPastAccess] = useState<PastRescheduleAccess | null>(null);
  const [pastAccessUntil, setPastAccessUntil] = useState(defaultPastAccessExpiry);
  const [pastAccessBusy, setPastAccessBusy] = useState(false);

  async function load() {
    try {
      const [{ user }, staff] = await Promise.all([
        api<{ user: Me }>("/auth/me"),
        api<StaffRow[]>("/staff"),
      ]);
      setMe(user);
      setRows(staff);
      if (selected) {
        const updated = staff.find((item) => item.userId === selected.userId) ?? null;
        setSelected(updated);
      }
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selected) return;
    setEditFirst(selected.firstName);
    setEditLast(selected.lastName);
    setEditPhone(selected.phone ?? "");
    setEditStartedAt(selected.startedAt?.slice(0, 10) ?? "");
    setEditRole(selected.roles.find((role) => ["MANAGER", "FINANCIER", "SUPPORT_MANAGER"].includes(role)) ?? "MANAGER");
    setSuspensionReason("");
  }, [selected?.userId]);

  useEffect(() => {
    setPastAccess(null);
    setPastAccessUntil(defaultPastAccessExpiry());
    if (!selected?.roles.includes("MANAGER")) return;
    let cancelled = false;
    api<PastRescheduleAccess>(`/staff/${selected.userId}/past-reschedule-access`)
      .then((access) => { if (!cancelled) setPastAccess(access); })
      .catch((e: any) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [selected?.userId, selected?.roles.join(",")]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (q && !`${row.firstName} ${row.lastName} ${row.lastName} ${row.firstName} ${row.email} ${row.phone ?? ""}`.toLowerCase().includes(q)) return false;
      if (roleFilter !== "ALL" && !row.roles.includes(roleFilter)) return false;
      if (statusFilter !== "ALL" && row.userStatus !== statusFilter) return false;
      return true;
    });
  }, [rows, search, roleFilter, statusFilter]);

  async function createStaff(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    try {
      const created = await api<any>("/staff", {
        method: "POST",
        body: JSON.stringify({ email, firstName, lastName, phone: phone || undefined, roleCode }),
      });
      await api(`/users/${created.userId ?? created.id}/invite`, { method: "POST" });
      setMessage("Працівника створено, запрошення відправлено.");
      setEmail("");
      setFirst("");
      setLast("");
      setPhone("");
      setShowCreate(false);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function saveProfile() {
    if (!selected) return;
    setError("");
    try {
      await api(`/staff/${selected.userId}`, {
        method: "PATCH",
        body: JSON.stringify({ firstName: editFirst, lastName: editLast, phone: editPhone, startedAt: editStartedAt }),
      });
      setMessage("Профіль працівника оновлено.");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function saveRole() {
    if (!selected) return;
    setError("");
    try {
      await api(`/staff/${selected.userId}/role`, { method: "PATCH", body: JSON.stringify({ roleCode: editRole }) });
      setMessage("Роль працівника оновлено.");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function updatePastRescheduleAccess(enabled: boolean) {
    if (!selected) return;
    setPastAccessBusy(true);
    setError("");
    try {
      const expiresAt = enabled ? new Date(pastAccessUntil) : null;
      if (enabled && (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) {
        setError("Вкажіть майбутню дату завершення додаткового доступу.");
        return;
      }
      const access = await api<PastRescheduleAccess>(`/staff/${selected.userId}/past-reschedule-access`, {
        method: "PUT",
        body: JSON.stringify({ enabled, expiresAt: enabled ? expiresAt!.toISOString() : undefined }),
      });
      setPastAccess(access);
      setMessage(enabled ? "Менеджеру надано право переносити уроки в минуле." : "Додаткове право менеджера відкликано.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPastAccessBusy(false);
    }
  }

  async function invite() {
    if (!selected) return;
    try {
      await api(`/users/${selected.userId}/invite`, { method: "POST" });
      setMessage("Нове запрошення відправлено.");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function suspend() {
    if (!selected || !suspensionReason.trim()) return;
    try {
      await api(`/users/${selected.userId}/suspend`, {
        method: "POST",
        body: JSON.stringify({ reason: suspensionReason.trim() }),
      });
      setMessage("Акаунт заблоковано, активні сесії завершено.");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function restore() {
    if (!selected) return;
    try {
      await api(`/users/${selected.userId}/restore`, { method: "POST" });
      setMessage("Акаунт розблоковано.");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function archive() {
    if (!selected) return;
    try {
      await api(`/staff/${selected.userId}/archive`, { method: "POST" });
      setMessage("Працівника перенесено в архів.");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function reactivate() {
    if (!selected) return;
    try {
      await api(`/staff/${selected.userId}/reactivate`, { method: "POST" });
      setMessage("Працівника відновлено.");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <PlatformShell allowedRoles={["ADMIN"]}>
      <div className="page-head">
        <div>
          <h1>Команда</h1>
          <p className="muted">Менеджери, фінансисти, техпідтримка та статуси їхніх акаунтів.</p>
        </div>
        <button className="btn" onClick={() => setShowCreate((value) => !value)}>{showCreate ? "Закрити" : "+ Працівник"}</button>
      </div>

      {message && <div className="success">{message}</div>}
      {error && <div className="error">{error}</div>}

      {showCreate && (
        <form className="card stack" onSubmit={createStaff} style={{ marginBottom: 16 }}>
          <h2>Новий працівник</h2>
          <div className="grid cols-2">
            <div className="field"><label>Імʼя</label><input className="input" required value={firstName} onChange={(e) => setFirst(e.target.value)} /></div>
            <div className="field"><label>Прізвище</label><input className="input" required value={lastName} onChange={(e) => setLast(e.target.value)} /></div>
            <div className="field"><label>Email</label><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="field"><label>Телефон</label><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            <div className="field"><label>Роль</label><select className="select" value={roleCode} onChange={(e) => setRole(e.target.value)}><option value="MANAGER">Менеджер</option><option value="FINANCIER">Фінансист</option><option value="SUPPORT_MANAGER">Техпідтримка</option></select></div>
          </div>
          <button className="btn">Створити та запросити</button>
        </form>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="grid cols-3">
          <div className="field"><label>Пошук</label><input className="input" placeholder="ПІБ, email або телефон" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <div className="field"><label>Роль</label><select className="select" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}><option value="ALL">Усі</option><option value="ADMIN">Admin</option><option value="MANAGER">Менеджер</option><option value="FINANCIER">Фінансист</option><option value="SUPPORT_MANAGER">Техпідтримка</option></select></div>
          <div className="field"><label>Статус акаунта</label><select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="ALL">Усі</option><option value="ACTIVE">Активні</option><option value="PENDING">Очікують активації</option><option value="SUSPENDED">Заблоковані</option><option value="ARCHIVED">Архів</option></select></div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Працівник</th><th>Роль</th><th>Статус</th><th>Телефон</th><th>Відповідальність</th><th>Старт</th></tr></thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.userId} onClick={() => setSelected(row)} style={{ cursor: "pointer" }}>
                <td><strong>{row.lastName} {row.firstName}</strong><br /><span className="muted">{row.email}</span></td>
                <td>{row.roles.map((role) => <span className="badge" key={role}>{roleLabel[role] ?? role}</span>)}</td>
                <td><span className={`badge ${row.userStatus === "ACTIVE" ? "paid" : "booked"}`}>{statusLabel[row.userStatus] ?? row.userStatus}</span></td>
                <td>{row.phone || "—"}</td>
                <td>{row.roles.includes("MANAGER") ? `${row.activeManagedStudents} учнів` : "—"}</td>
                <td>{dateOnly(row.startedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="sheet-backdrop" onClick={() => setSelected(null)}>
          <aside className="sheet" onClick={(e) => e.stopPropagation()}>
            <button className="sheet-close" onClick={() => setSelected(null)}>×</button>
            <div className="stack" style={{ marginTop: 36 }}>
              <div>
                <h2>{selected.lastName} {selected.firstName}</h2>
                <div className="muted">{selected.email}</div>
              </div>

              <div className="row">
                <span className={`badge ${selected.userStatus === "ACTIVE" ? "paid" : "booked"}`}>{statusLabel[selected.userStatus] ?? selected.userStatus}</span>
                {selected.roles.map((role) => <span className="badge" key={role}>{roleLabel[role] ?? role}</span>)}
              </div>

              <section className="card stack">
                <h3>Профіль</h3>
                <div className="grid cols-2">
                  <div className="field"><label>Імʼя</label><input className="input" value={editFirst} onChange={(e) => setEditFirst(e.target.value)} disabled={selected.userStatus === "ARCHIVED"} /></div>
                  <div className="field"><label>Прізвище</label><input className="input" value={editLast} onChange={(e) => setEditLast(e.target.value)} disabled={selected.userStatus === "ARCHIVED"} /></div>
                  <div className="field"><label>Телефон</label><input className="input" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} disabled={selected.userStatus === "ARCHIVED"} /></div>
                  <div className="field"><label>Працює з</label><input className="input" type="date" value={editStartedAt} onChange={(e) => setEditStartedAt(e.target.value)} disabled={selected.userStatus === "ARCHIVED"} /></div>
                </div>
                {selected.userStatus !== "ARCHIVED" && <button className="btn secondary" onClick={saveProfile}>Зберегти профіль</button>}
              </section>

              {!selected.roles.includes("ADMIN") && (
                <section className="card stack">
                  <h3>Роль</h3>
                  <select className="select" value={editRole} onChange={(e) => setEditRole(e.target.value)} disabled={selected.userId === me?.id || selected.userStatus === "ARCHIVED"}>
                    <option value="MANAGER">Менеджер</option>
                    <option value="FINANCIER">Фінансист</option>
                    <option value="SUPPORT_MANAGER">Техпідтримка</option>
                  </select>
                  <p className="muted form-note">Менеджеру з активними учнями не можна змінити роль, доки учнів не перепризначено.</p>
                  <button className="btn secondary" onClick={saveRole} disabled={selected.userId === me?.id || selected.userStatus === "ARCHIVED"}>Змінити роль</button>
                </section>
              )}

              {selected.roles.includes("MANAGER") && (
                <section className="card stack">
                  <h3>Додаткові права</h3>
                  <div><strong>Перенесення уроків у минуле</strong><p className="muted form-note" style={{marginTop:6}}>Небезпечна адміністративна дія для виправлення історії. Доступ видається конкретному менеджеру на обмежений час і фіксується в аудиті.</p></div>
                  {pastAccess?.enabled ? (
                    <>
                      <div className="success">Доступ активний{pastAccess.expiresAt ? ` до ${dateTime(pastAccess.expiresAt)}` : ""}.</div>
                      <button className="btn secondary" disabled={pastAccessBusy} onClick={()=>void updatePastRescheduleAccess(false)}>{pastAccessBusy ? "Зберігаємо…" : "Відкликати право"}</button>
                    </>
                  ) : (
                    <>
                      <div className="field"><label>Надати доступ до</label><input className="input" type="datetime-local" value={pastAccessUntil} onChange={(e)=>setPastAccessUntil(e.target.value)} disabled={selected.userStatus !== "ACTIVE" || pastAccessBusy} /></div>
                      <button className="btn secondary" disabled={selected.userStatus !== "ACTIVE" || pastAccessBusy || !pastAccessUntil} onClick={()=>void updatePastRescheduleAccess(true)}>{pastAccessBusy ? "Зберігаємо…" : "Надати право"}</button>
                    </>
                  )}
                </section>
              )}

              <section className="card stack">
                <h3>Доступ</h3>
                {selected.lastInvitedAt && <div className="muted">Останнє запрошення: {dateTime(selected.lastInvitedAt)}{selected.lastInviteAcceptedAt ? " · прийнято" : ""}</div>}
                {selected.userStatus === "PENDING" && <button className="btn secondary" onClick={invite}>Надіслати запрошення ще раз</button>}
                {selected.userStatus === "ACTIVE" && selected.userId !== me?.id && !selected.roles.includes("ADMIN") && (
                  <>
                    <div className="field"><label>Причина блокування</label><input className="input" value={suspensionReason} onChange={(e) => setSuspensionReason(e.target.value)} placeholder="Наприклад: доступ тимчасово призупинено" /></div>
                    <button className="btn secondary" onClick={suspend} disabled={!suspensionReason.trim()}>Заблокувати акаунт</button>
                  </>
                )}
                {selected.userStatus === "SUSPENDED" && <button className="btn" onClick={restore}>Розблокувати акаунт</button>}
                {selected.userStatus !== "ARCHIVED" && selected.userStatus !== "SUSPENDED" && selected.userId !== me?.id && !selected.roles.includes("ADMIN") && <button className="btn secondary" onClick={archive}>Архівувати працівника</button>}
                {selected.userStatus === "ARCHIVED" && <button className="btn" onClick={reactivate}>Відновити з архіву</button>}
              </section>
            </div>
          </aside>
        </div>
      )}
    </PlatformShell>
  );
}
