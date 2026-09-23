"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ErrorCard, LoadingCard } from "./loadable";
import { NewStudentWizard } from "./new-student-wizard";
import { PlatformShell } from "./platform-shell";
import { useData } from "../lib/use-data";

export function FamiliesList({ role }: { role: "ADMIN" | "MANAGER" }) {
  const [search, setSearch] = useState("");
  const [lifecycle, setLifecycle] = useState("ACTIVE");
  const [mine, setMine] = useState(role === "MANAGER");
  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (lifecycle) params.set("lifecycle", lifecycle);
    if (mine) params.set("manager", "mine");
    return `/ops/families?${params}`;
  }, [search, lifecycle, mine]);
  const { data, error, loading, reload } = useData<any[]>(query);
  const base = role === "ADMIN" ? "/admin" : "/manager";

  return <PlatformShell allowedRoles={role === "ADMIN" ? ["ADMIN", "SUPPORT_MANAGER"] : ["MANAGER"]}>
    <div className="page-head">
      <div><h1>Сімʼї</h1><p className="muted">Один батьківський акаунт, усі діти, відповідальні менеджери та життєвий цикл сімʼї.</p></div>
      <NewStudentWizard role={role} onDone={reload} />
    </div>
    <div className="card row wrap-row" style={{ marginBottom: 16 }}>
      <input className="input" style={{ maxWidth: 360 }} placeholder="Батьки, дитина, телефон або email" value={search} onChange={(event) => setSearch(event.target.value)} />
      {role === "MANAGER" && <label className="row"><input type="checkbox" checked={mine} onChange={(event) => setMine(event.target.checked)} /> Мої сімʼї</label>}
      <select className="select" style={{ maxWidth: 220 }} value={lifecycle} onChange={(event) => setLifecycle(event.target.value)}>
        <option value="ACTIVE">Не в архіві</option>
        <option value="ARCHIVED">Архів</option>
        <option value="ALL">Усі</option>
      </select>
    </div>
    {loading ? <LoadingCard /> : error ? <ErrorCard error={error} /> : <div className="table-wrap"><table>
      <thead><tr><th>Сімʼя</th><th>Контакт</th><th>Діти</th><th>Активне навчання</th><th>Менеджери</th><th>Акаунт</th></tr></thead>
      <tbody>{(data ?? []).map((family: any) => <tr key={family.id}>
        <td><Link href={`${base}/families/${family.id}`}><strong>{family.parentLastName} {family.parentFirstName}</strong></Link>{family.archivedAt && <div><span className="badge">ARCHIVED</span></div>}</td>
        <td>{family.parentPhone}<br/><span className="muted">{family.parentEmail}</span></td>
        <td><strong>{family.activeChildrenCount}</strong> активних / {family.childrenCount}<div className="muted">{(family.children ?? []).slice(0, 3).map((child: any) => `${child.lastName} ${child.firstName}`).join(" · ")}</div></td>
        <td>{family.activeEnrollmentsCount} предметів</td>
        <td>{(family.managers ?? []).length ? (family.managers ?? []).map((manager: any) => `${manager.lastName} ${manager.firstName}`).join(" · ") : "—"}</td>
        <td><span className="badge">{family.parentAccountStatus}</span></td>
      </tr>)}{!data?.length && <tr><td colSpan={6}><div className="empty">Нічого не знайдено</div></td></tr>}</tbody>
    </table></div>}
  </PlatformShell>;
}
