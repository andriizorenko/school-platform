"use client";

import { useState } from "react";
import { api } from "../lib/api";
import { useData } from "../lib/use-data";
import { PlatformShell } from "./platform-shell";
import { ErrorCard, LoadingCard } from "./loadable";
import { phoneNumber } from "../lib/format";

const statusLabels: Record<string, string> = {
  NEW: "Нова",
  REVIEWING: "На розгляді",
  APPROVED: "Прийнято",
  REJECTED: "Відхилено",
};
const statuses = ["NEW", "REVIEWING", "APPROVED", "REJECTED"];

export function TeacherApplicationsPage() {
  const [status, setStatus] = useState("");
  const { data, error, loading, reload } = useData<any[]>(`/teacher-applications${status ? `?status=${status}` : ""}`);
  const [msg, setMsg] = useState("");

  async function review(id: string, next: "APPROVED" | "REJECTED") {
    if (next === "REJECTED" && !confirm("Відхилити анкету?")) return;
    try {
      await api(`/teacher-applications/${id}/review`, { method: "PATCH", body: JSON.stringify({ status: next }) });
      setMsg(next === "APPROVED" ? "Викладача створено, запрошення надіслано електронною поштою." : "Анкету відхилено");
      void reload();
    } catch (e: any) {
      alert(e.message);
    }
  }

  return <PlatformShell allowedRoles={["ADMIN"]}>
    <div className="page-head">
      <div><h1>Анкети викладачів</h1><p className="muted">Перегляд кандидатів, прийняття в команду та автоматичне запрошення електронною поштою.</p></div>
      <div className="field" style={{ minWidth: 200 }}>
        <label>Статус анкети</label>
        <select className="select" value={status} onChange={e=>setStatus(e.target.value)}>
          <option value="">Усі статуси</option>
          {statuses.map(value => <option key={value} value={value}>{statusLabels[value]}</option>)}
        </select>
      </div>
    </div>
    {msg && <div className="success">{msg}</div>}
    {loading ? <LoadingCard/> : error ? <ErrorCard error={error}/> : !data?.length ? (
      <div className="card empty">Анкет викладачів за обраними умовами поки немає.</div>
    ) : <div className="grid cols-2">{data.map(application => <div className="card stack" key={application.id}>
      <div className="row" style={{ justifyContent: "space-between" }}><h2>{application.last_name} {application.first_name}</h2><span className="badge">{statusLabels[application.status] ?? application.status}</span></div>
      <div>{application.email}<br/>{phoneNumber(application.phone)}<br/><span className="muted">{application.telegram}</span></div>
      <div className="row">{application.subjects?.map((subject: any) => <span className="badge" key={subject.id}>{subject.name}</span>)}</div>
      {application.education && <div><strong>Освіта</strong><p className="muted">{application.education}</p></div>}
      {application.experience && <div><strong>Досвід</strong><p className="muted">{application.experience}</p></div>}
      {application.approximate_hours && <div><strong>Орієнтовні години</strong><p className="muted">{application.approximate_hours}</p></div>}
      {["NEW", "REVIEWING"].includes(application.status) && <div className="row"><button className="btn" onClick={()=>review(application.id,"APPROVED")}>Прийняти</button><button className="btn danger" onClick={()=>review(application.id,"REJECTED")}>Відхилити</button></div>}
    </div>)}</div>}
  </PlatformShell>;
}
