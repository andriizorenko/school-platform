"use client";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { PlatformShell } from "./platform-shell";
import { dateTime, lessonCount, money, subjectCount } from "../lib/format";

export function ParentLearningPage(){
  const[dash,setDash]=useState<any>(null);
  const[reports,setReports]=useState<Record<string,any[]>>({});
  const[eligibility,setEligibility]=useState<Record<string,any[]>>({});
  const[journals,setJournals]=useState<Record<string,any[]>>({});
  const[expanded,setExpanded]=useState<Record<string,boolean>>({});
  const[requestVisibility,setRequestVisibility]=useState<Record<string,boolean>>({});
  const[busy,setBusy]=useState<string|null>(null);
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState("");
  const[msg,setMsg]=useState("");

  async function load(){
    setLoading(true);setError("");
    try{
      const d=await api<any>("/parent/dashboard");
      const reportEntries=await Promise.all((d.students??[]).map(async(s:any)=>[s.id,await api<any[]>(`/students/${s.id}/reports`).catch(()=>[])] as const));
      const eligibilityEntries=await Promise.all((d.students??[]).map(async(s:any)=>[s.id,await api<any[]>(`/students/${s.id}/reports/eligibility`).catch(()=>[])] as const));
      const allEnrollments=(d.students??[]).flatMap((s:any)=>s.enrollments??[]);
      const journalEntries=await Promise.all(allEnrollments.map(async(e:any)=>[e.id,await api<any[]>(`/enrollments/${e.id}/journal`).catch(()=>[])] as const));
      setDash(d);setReports(Object.fromEntries(reportEntries));setEligibility(Object.fromEntries(eligibilityEntries));setJournals(Object.fromEntries(journalEntries));
      setRequestVisibility(current=>{const next={...current};for(const enrollment of allEnrollments)if(next[enrollment.id]===undefined)next[enrollment.id]=true;return next});
    }catch(e:any){setError(e.message)}finally{setLoading(false)}
  }
  useEffect(()=>{void load()},[]);

  async function request(studentId:string,enrollment:any){
    setBusy(`request:${enrollment.id}`);setError("");setMsg("");
    try{
      await api(`/students/${studentId}/reports/request`,{method:"POST",body:JSON.stringify({subjectId:enrollment.subject.id,visibleToStudent:requestVisibility[enrollment.id]!==false})});
      setMsg(`Запит на звіт з предмета «${enrollment.subject.name}» надіслано викладачу.`);await load();
    }catch(e:any){setError(e.message)}finally{setBusy(null)}
  }
  async function visibility(reportId:string,value:boolean){
    setBusy(`visibility:${reportId}`);setError("");
    try{await api(`/reports/${reportId}/visibility`,{method:"PATCH",body:JSON.stringify({visibleToStudent:value})});await load()}catch(e:any){setError(e.message)}finally{setBusy(null)}
  }

  function eligibilityFor(studentId:string,enrollmentId:string){return(eligibility[studentId]??[]).find((x:any)=>x.enrollmentId===enrollmentId)}
  function statusCopy(row:any){
    if(!row)return{label:"Перевіряємо",tone:"",text:""};
    if(row.status==="AVAILABLE")return{label:"Можна запросити",tone:"success-badge",text:`Проведено ${lessonCount(row.completedLessonsSincePreviousReport)} після попереднього звіту.`};
    if(row.status==="PENDING")return{label:"Звіт запитано",tone:"report-alert",text:row.pendingRequest?.targetStartsAt?`Викладач підготує звіт після заняття ${dateTime(row.pendingRequest.targetStartsAt)}.`:"Запит уже у викладача; цільове заняття ще не призначене."};
    if(row.status==="TOO_EARLY")return{label:`${row.completedLessonsSincePreviousReport}/${row.requiredLessons} занять`,tone:"",text:`Щоб запросити новий звіт, потрібно ще ${lessonCount(row.remainingLessons)}.`};
    if(row.status==="NO_TEACHER")return{label:"Без викладача",tone:"",text:"Запит стане доступним після призначення основного викладача."};
    return{label:"Навчання неактивне",tone:"",text:"Для неактивного предмета новий звіт не запитується."};
  }

  const totalEnrollments=(dash?.students??[]).reduce((sum:number,s:any)=>sum+(s.enrollments?.length??0),0);
  return <PlatformShell allowedRoles={["PARENT"]}>
    <div className="page-head"><div><h1>Навчання сімʼї</h1><p className="muted">Журнали, прогрес і звіти по всіх дітях та предметах в одному місці.</p></div></div>
    {error&&<div className="error">{error}</div>}{msg&&<div className="success">{msg}</div>}
    {loading?<div className="card muted">Завантажуємо навчання…</div>:<div className="stack parent-learning-page">
      <div className="grid cols-3 parent-learning-summary">
        <div className="card"><div className="muted">Дітей</div><div className="metric">{dash?.students?.length??0}</div></div>
        <div className="card"><div className="muted">Предметів</div><div className="metric">{totalEnrollments}</div></div>
        <div className="card"><div className="muted">Готових звітів</div><div className="metric">{Object.values(reports).reduce((sum:number,items:any)=>sum+(items?.length??0),0)}</div></div>
      </div>

      {(dash?.students??[]).map((student:any)=><section className="parent-learning-student" key={student.id}>
        <div className="parent-learning-student-head">
          <div><h2>{student.lastName} {student.firstName}</h2><p className="muted">{student.gradeLevel?`${student.gradeLevel} клас`:"Клас не вказано"}</p></div>
          <span className="badge">{subjectCount(student.enrollments?.length ?? 0)}</span>
        </div>
        <div className="stack">{(student.enrollments??[]).map((enrollment:any)=>{
          const gate=eligibilityFor(student.id,enrollment.id);const status=statusCopy(gate);
          const journal=[...(journals[enrollment.id]??[])].reverse();const visibleJournal=expanded[enrollment.id]?journal:journal.slice(0,5);
          const subjectReports=(reports[student.id]??[]).filter((r:any)=>r.subjectId===enrollment.subject.id);
          return <article className="card parent-subject-card" key={enrollment.id}>
            <div className="parent-subject-head">
              <div><div className="row"><h2>{enrollment.subject.name}</h2><span className={`badge ${enrollment.status==="ACTIVE"?"success-badge":""}`}>{enrollment.status==="ACTIVE"?"Активне":enrollment.status==="PAUSED"?"Пауза":"Неактивне"}</span></div><div className="muted">{enrollment.primaryTeacher?`${enrollment.primaryTeacher.lastName} ${enrollment.primaryTeacher.firstName}`:"Викладача не призначено"}</div></div>
              <div className="parent-subject-balance"><span className="muted">Залишилось</span><strong>{lessonCount(enrollment.balanceLessonUnits)}</strong></div>
            </div>

            <div className="parent-report-request-box">
              <div><div className="row"><strong>Звіт про прогрес</strong><span className={status.tone==="report-alert"?"report-alert":`badge ${status.tone}`}>{status.label}</span></div><p className="muted">{status.text}</p></div>
              {gate?.status==="AVAILABLE"&&<div className="parent-report-request-actions"><label className="row parent-report-visibility"><input type="checkbox" checked={requestVisibility[enrollment.id]!==false} onChange={event=>setRequestVisibility(state=>({...state,[enrollment.id]:event.target.checked}))}/> Показати готовий звіт дитині</label><button className="btn" disabled={busy===`request:${enrollment.id}`} onClick={()=>void request(student.id,enrollment)}>{busy===`request:${enrollment.id}`?"Надсилаю…":"Запросити звіт"}</button></div>}
            </div>

            <div className="parent-journal-section">
              <div className="section-heading row"><div><h3>Журнал</h3><p className="muted">Проведені заняття, теми та домашні завдання.</p></div>{journal.length>5&&<button className="btn secondary" onClick={()=>setExpanded(state=>({...state,[enrollment.id]:!state[enrollment.id]}))}>{expanded[enrollment.id]?"Згорнути":`Усі заняття · ${journal.length}`}</button>}</div>
              {visibleJournal.length?<div className="table-wrap"><table className="journal-table"><thead><tr><th>№</th><th>Дата</th><th>Тема</th><th>ДЗ</th><th>Заміна</th></tr></thead><tbody>{visibleJournal.map((entry:any)=><tr key={entry.id}><td>{entry.lessonNumber}</td><td>{dateTime(entry.startsAt)}</td><td>{entry.topicTitle||"—"}</td><td>{entry.homeworkAssigned?"Задано":"Не задано"}</td><td>{entry.isSubstitute?<span className="substitute-label">Провів: {entry.actualTeacherFullName}</span>:<span className="muted">—</span>}</td></tr>)}</tbody></table></div>:<div className="empty compact-empty">Проведених занять ще немає.</div>}
            </div>

            <div className="parent-reports-section">
              <div className="section-heading"><h3>Звіти</h3><p className="muted">Перший обовʼязковий звіт і регулярні звіти за запитом.</p></div>
              {subjectReports.length?<div className="report-history-grid">{subjectReports.map((report:any)=><div className="report-history-card" key={report.id}><div className="row report-request-heading"><div><strong>{report.reportType==="INITIAL"?"Перший звіт":"Звіт про прогрес"}</strong><div className="muted">{report.teacherLastName} {report.teacherFirstName} · {dateTime(report.createdAt)}</div></div><span className="badge">{report.visibleToStudent?"Бачить дитина":"Лише батьки"}</span></div><p><strong>Сильні сторони:</strong> {report.strengths}</p><p><strong>Що повторити:</strong> {report.gaps}</p><p><strong>План:</strong> {report.actionPlan}</p><label className="row parent-report-toggle"><input type="checkbox" disabled={busy===`visibility:${report.id}`} checked={Boolean(report.visibleToStudent)} onChange={event=>void visibility(report.id,event.target.checked)}/> Показувати дитині</label></div>)}</div>:<div className="empty compact-empty">Звітів з цього предмета ще немає.</div>}
            </div>
          </article>
        })}{!(student.enrollments?.length)&&<div className="card muted">Активних предметів поки немає.</div>}</div>
      </section>)}
      {!(dash?.students?.length)&&<div className="card muted">У сімʼї ще немає профілів дітей.</div>}
    </div>}
  </PlatformShell>
}

export function ParentPaymentsPage(){const[rows,setRows]=useState<any[]>([]);const[error,setError]=useState("");useEffect(()=>{api<any[]>("/parent/payments").then(setRows).catch((e:any)=>setError(e.message))},[]);return <PlatformShell allowedRoles={["PARENT"]}><div className="page-head"><div><h1>Оплати</h1><p className="muted">Історія оплат занять і курсів усієї сімʼї.</p></div></div>{error&&<div className="error">{error}</div>}<div className="table-wrap"><table><thead><tr><th>Дата</th><th>Що оплачено</th><th>Учень</th><th>Сума</th><th>Статус</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{dateTime(r.paid_at??r.created_at)}</td><td>{r.product_type==="LESSONS"?`${r.subject_name} · ${r.lesson_units} занять`:r.product_type==="COURSE"?r.course_title:"Інше"}</td><td>{r.student_last_name??""} {r.student_first_name??""}</td><td>{money(r.total_minor,r.currency)}</td><td><span className={`badge ${r.status==="PAID"?"paid":"booked"}`}>{r.status}</span></td></tr>)}</tbody></table></div></PlatformShell>}
