"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PlatformShell } from "./platform-shell";
import { useData } from "../lib/use-data";
import { ErrorCard, LoadingCard } from "./loadable";
import { NewStudentWizard } from "./new-student-wizard";
import { lessonCount, phoneNumber } from "../lib/format";

export function StudentsList({role}: {role:"ADMIN"|"MANAGER"|"TEACHER"}) {
  const [search,setSearch]=useState(""); const [balance,setBalance]=useState(""); const [lifecycle,setLifecycle]=useState("ACTIVE"); const [mine,setMine]=useState(role==="MANAGER");
  const query=useMemo(()=>{const p=new URLSearchParams();if(search)p.set("search",search);if(balance)p.set("balance",balance);if(lifecycle)p.set("lifecycle",lifecycle);if(mine)p.set("manager","mine");return `/ops/students?${p}`;},[search,balance,lifecycle,mine]);
  const {data,error,loading,reload}=useData<any[]>(query);
  const base=role.toLowerCase(); const allowed=role==="ADMIN"?["ADMIN","SUPPORT_MANAGER"]:[role];
  return <PlatformShell allowedRoles={allowed}><div className="page-head"><div><h1>{role==="TEACHER"?"Мої учні":"Учні"}</h1><p className="muted">Пошук, предмети, викладачі та залишок занять.</p></div>{role!=="TEACHER"&&<NewStudentWizard role={role} onDone={reload}/>}</div>
    <div className="card row" style={{marginBottom:16}}><input className="input" style={{maxWidth:320}} placeholder="Ім'я, прізвище, телефон" value={search} onChange={e=>setSearch(e.target.value)}/>{role==="MANAGER"&&<label className="row"><input type="checkbox" checked={mine} onChange={e=>setMine(e.target.checked)}/> Мої учні</label>}<select className="select" style={{maxWidth:220}} value={balance} onChange={e=>setBalance(e.target.value)}><option value="">Будь-який баланс</option><option value="LOW">1–3 заняття</option><option value="ZERO">0 занять</option><option value="POSITIVE">Більше 3</option></select>{role!=="TEACHER"&&<select className="select" style={{maxWidth:190}} value={lifecycle} onChange={e=>setLifecycle(e.target.value)}><option value="ACTIVE">Активні</option><option value="ARCHIVED">Архів</option><option value="ALL">Усі</option></select>}</div>
    {loading?<LoadingCard/>:error?<ErrorCard error={error}/>:<div className="table-wrap"><table><thead><tr><th>Учень</th><th>Клас</th><th>Батьки</th><th>Предмети</th><th>Менеджер</th></tr></thead><tbody>{(data??[]).map((s:any)=><tr key={s.id}><td><Link href={`/${base}/students/${s.id}`}><strong>{s.last_name} {s.first_name}</strong></Link>{s.archived_at&&<div><span className="badge">В архіві</span></div>}</td><td>{s.grade_level ? `${s.grade_level} клас` : "—"}</td><td>{s.parent_last_name} {s.parent_first_name}<br/><span className="muted">{phoneNumber(s.parent_phone)}</span></td><td>{(s.enrollments??[]).map((e:any)=><div key={e.id}>{e.subjectName}: {lessonCount(e.balanceLessonUnits)} · {e.teacherName||"без викладача"}</div>)}</td><td>{s.manager_last_name?`${s.manager_last_name} ${s.manager_first_name}`:"—"}</td></tr>)}{!data?.length&&<tr><td colSpan={5}><div className="empty">Нічого не знайдено</div></td></tr>}</tbody></table></div>}
  </PlatformShell>;
}
