"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PlatformShell } from "./platform-shell";
import { useData } from "../lib/use-data";
import { ErrorCard, LoadingCard } from "./loadable";
import { kyivDateValue, money } from "../lib/format";
import { StatCard } from "./stat-card";

function today(){return kyivDateValue(new Date())}
function monthStart(){return `${today().slice(0,7)}-01`}

export function AdminFinancePage(){
  const[from,setFrom]=useState(monthStart());
  const[to,setTo]=useState(today());
  const[bucket,setBucket]=useState<"day"|"month">("day");
  const path=useMemo(()=>`/ops/analytics?from=${from}&to=${to}&bucket=${bucket}`,[from,to,bucket]);
  const{data,error,loading}=useData<any>(path);
  function preset(kind:"month"|"30"|"year"){
    const current=today();
    if(kind==="month")setFrom(`${current.slice(0,7)}-01`);
    if(kind==="30")setFrom(kyivDateValue(new Date(),-29));
    if(kind==="year")setFrom(`${current.slice(0,4)}-01-01`);
    setTo(current);
  }
  return <PlatformShell allowedRoles={["ADMIN"]}>
    <div className="page-head admin-finance-head"><div><h1>Фінанси та аналітика школи</h1><p className="muted">Надходження, нарахування викладачам і навчальна активність за обраний період.</p></div><div className="row admin-finance-links"><Link className="btn secondary" href="/manager/payments">Історія оплат</Link><Link className="btn secondary" href="/financier">Виплати викладачам</Link></div></div>
    <section className="card stack admin-finance-filters">
      <div className="row admin-finance-presets"><button type="button" className="btn secondary" onClick={()=>preset("month")}>Цей місяць</button><button type="button" className="btn secondary" onClick={()=>preset("30")}>30 днів</button><button type="button" className="btn secondary" onClick={()=>preset("year")}>Цей рік</button></div>
      <div className="grid cols-3"><div className="field"><label htmlFor="finance-from">Від</label><input id="finance-from" className="input" type="date" max={to} required value={from} onChange={e=>setFrom(e.target.value)}/></div><div className="field"><label htmlFor="finance-to">До</label><input id="finance-to" className="input" type="date" min={from} max={today()} required value={to} onChange={e=>setTo(e.target.value)}/></div><div className="field"><label htmlFor="finance-bucket">Групування</label><select id="finance-bucket" className="select" value={bucket} onChange={e=>setBucket(e.target.value as "day"|"month")}><option value="day">По днях</option><option value="month">По місяцях</option></select></div></div>
    </section>
    {loading?<LoadingCard/>:error?<ErrorCard error={error}/>:data&&<div className="stack">
      <div className="grid cols-4"><StatCard label="Надходження" value={money(data.summary.revenue_minor)}/><StatCard label="Нараховано викладачам" value={money(data.summary.teacher_accrual_minor)}/><StatCard label="Різниця до інших витрат" value={money(data.summary.operatingDifferenceMinor)}/><StatCard label="Оплачених замовлень" value={data.summary.paid_orders}/></div>
      <p className="muted">«Різниця до інших витрат» не є чистим прибутком: інші витрати школи тут не враховані.</p>
      <div className="grid cols-4"><StatCard label="Проведено занять" value={data.learning.conducted}/><StatCard label="Регулярні" value={data.learning.regular_conducted}/><StatCard label="Перші" value={data.learning.first_conducted}/><StatCard label="Оплачений пропуск" value={data.learning.charged_no_show}/></div>

      <section className="card finance-breakdown-card"><h2>Динаміка</h2>{!data.trend.length?<div className="empty">За цей період ще немає фінансових рухів.</div>:<div className="table-wrap"><table><thead><tr><th>Період</th><th>Надходження</th><th>Нараховано</th><th>Різниця</th></tr></thead><tbody>{data.trend.map((x:any)=><tr key={x.bucket}><td>{String(x.bucket).slice(0,10)}</td><td>{money(x.revenue_minor)}</td><td>{money(x.teacher_accrual_minor)}</td><td><strong>{money(Number(x.revenue_minor)-Number(x.teacher_accrual_minor))}</strong></td></tr>)}</tbody></table></div>}</section>

      <div className="grid cols-2">
        <section className="card finance-breakdown-card"><h2>Регулярні заняття за предметами</h2>{data.regular.length?data.regular.map((x:any)=><div className="lesson-row" key={x.subject_id}><span>{x.name}<br/><small className="muted">{x.purchases} покупок</small></span><strong>{money(x.revenue_minor)}</strong></div>):<div className="empty">Немає покупок</div>}</section>
        <section className="card finance-breakdown-card"><h2>Перші заняття</h2>{data.firstLessons.length?data.firstLessons.map((x:any)=><div className="lesson-row" key={x.subject_id}><span>{x.name}<br/><small className="muted">{x.purchases} оплат</small></span><strong>{money(x.revenue_minor)}</strong></div>):<div className="empty">Немає оплат</div>}</section>
        <section className="card finance-breakdown-card"><h2>Курси</h2>{data.courses.length?data.courses.map((x:any)=><div className="lesson-row" key={x.course_id}><span>{x.title}<br/><small className="muted">{x.purchases} покупок</small></span><strong>{money(x.revenue_minor)}</strong></div>):<div className="empty">Немає покупок курсів</div>}</section>
        <section className="card finance-breakdown-card"><h2>Нарахування викладачам</h2>{data.payroll.length?data.payroll.map((x:any)=><div className="lesson-row" key={x.subject_id??"none"}><span>{x.name??"Без предмета"}<br/><small className="muted">{x.accruals} нарахувань</small></span><strong>{money(x.amount_minor)}</strong></div>):<div className="empty">Немає нарахувань</div>}</section>
      </div>
    </div>}
  </PlatformShell>
}
