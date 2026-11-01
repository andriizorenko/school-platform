"use client";

import { FormEvent, useState } from "react";
import { PlatformShell } from "./platform-shell";
import { api } from "../lib/api";
import { useData } from "../lib/use-data";
import { ErrorCard, LoadingCard } from "./loadable";
import { phoneNumber } from "../lib/format";
import { LeadWorkflow } from "./lead-workflow";

const statusLabels: Record<string, string> = {
  NEW: "Нова",
  CONTACTED: "Звʼязалися",
  FIRST_LESSON: "Записались на перше заняття",
  CONVERTED: "Записались на регулярні заняття",
  LOST: "Відмовились",
};

const sourceLabels: Record<string, string> = {
  MANUAL: "Вручну",
  WEBSITE_SIGNUP: "Сайт",
  OTHER: "Інше",
  CALLBACK: "Зворотний дзвінок",
  COURSE: "Курс",
};

const statuses = ["NEW", "CONTACTED", "FIRST_LESSON", "CONVERTED", "LOST"];

export function LeadsPage({ role }: { role: "ADMIN" | "MANAGER" }) {
  const [status, setStatus] = useState("");
  const [selectedLead, setSelectedLead] = useState<any | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<"NEW" | "CONTACTED" | "FIRST_LESSON" | "CONVERTED" | "LOST">("NEW");
  const { data, error, loading, reload } = useData<any[]>(`/leads${status ? `?status=${status}` : ""}`);
  const [phone, setPhone] = useState("");
  const [parentFirstName, setParentFirstName] = useState("");
  const [studentFirstName, setStudentFirstName] = useState("");

  async function add(event: FormEvent) {
    event.preventDefault();
    await api("/leads", { method: "POST", body: JSON.stringify({ source: "MANUAL", phone, parentFirstName, studentFirstName }) });
    setPhone(""); setParentFirstName(""); setStudentFirstName("");
    void reload();
  }


  return <PlatformShell allowedRoles={role === "ADMIN" ? ["ADMIN", "SUPPORT_MANAGER"] : ["MANAGER"]}>
    <div className="page-head">
      <div><h1>Заявки</h1><p className="muted">Звернення із сайту, зворотних дзвінків, курсів і ручного введення.</p></div>
    </div>
    <form className="card row wrap-row" onSubmit={add} style={{ marginBottom: 16 }}>
      <input className="input" style={{ maxWidth: 200 }} placeholder="Імʼя батьків" value={parentFirstName} onChange={e=>setParentFirstName(e.target.value)}/>
      <input className="input" style={{ maxWidth: 200 }} placeholder="Імʼя учня" value={studentFirstName} onChange={e=>setStudentFirstName(e.target.value)}/>
      <input className="input" style={{ maxWidth: 220 }} placeholder="Телефон" value={phone} onChange={e=>setPhone(e.target.value)} required/>
      <button className="btn">+ Створити заявку</button>
      <select className="select" style={{ maxWidth: 200, marginLeft: "auto" }} value={status} onChange={e=>setStatus(e.target.value)}>
        <option value="">Усі статуси</option>
        {statuses.map(value => <option key={value} value={value}>{statusLabels[value]}</option>)}
      </select>
    </form>
    {loading ? <LoadingCard/> : error ? <ErrorCard error={error}/> : !data?.length ? (
      <div className="card empty">Заявок за обраними умовами поки немає.</div>
    ) : <div className="table-wrap"><table>
      <thead><tr><th>Контакт</th><th>Учень</th><th>Предмет</th><th>Джерело</th><th>Статус</th></tr></thead>
      <tbody>{data.map((lead) => <tr key={lead.id}>
        <td><strong>{lead.parent_first_name ?? "—"} {lead.parent_last_name ?? ""}</strong><br/>{phoneNumber(lead.phone)}</td>
        <td>{lead.student_first_name ?? "—"} {lead.student_last_name ?? ""}<br/><span className="muted">{lead.grade_level ? `${lead.grade_level} клас` : ""}</span></td>
        <td>{lead.subject_name ?? "—"}</td>
        <td><strong>{sourceLabels[lead.source] ?? lead.source}</strong>{lead.source === "COURSE" && <div className="muted">{lead.source_course_title ?? "Курс"}{lead.source_topic_name ? ` · ${lead.source_topic_name}` : ""}{lead.source_test_percentage != null ? ` · ${Math.round(Number(lead.source_test_percentage))}%` : ""}</div>}</td>
        <td><div className="row wrap-row"><span className="badge">{statusLabels[lead.status] ?? lead.status}</span><button type="button" className="btn secondary" onClick={()=>{setSelectedLead(lead);setSelectedStatus(lead.status)}}>Опрацювати</button></div>{lead.status==="LOST"&&lead.refusal_reason&&<small className="muted">{lead.refusal_reason}</small>}</td>
      </tr>)}</tbody>
    </table></div>}
    {selectedLead && <LeadWorkflow key={selectedLead.id} lead={selectedLead} status={selectedStatus} role={role} onClose={()=>setSelectedLead(null)} onSaved={()=>void reload()} />}
  </PlatformShell>;
}
