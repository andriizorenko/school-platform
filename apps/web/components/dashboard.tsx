"use client";
import Link from "next/link";
import { PlatformShell } from "./platform-shell";
import { StatCard } from "./stat-card";
import { ErrorCard, LoadingCard } from "./loadable";
import { useData } from "../lib/use-data";
import { money } from "../lib/format";

export function OpsDashboard({role}: {role:"ADMIN"|"MANAGER"}) {
  const {data,error,loading}=useData<any>("/ops/dashboard");
  const allowed=role==="ADMIN"?["ADMIN","SUPPORT_MANAGER"]:["MANAGER"];
  const base=role.toLowerCase();
  return <PlatformShell allowedRoles={allowed}>
    <div className="page-head"><div><h1>{role==="ADMIN"?"Стан школи":"Головна менеджера"}</h1><p className="muted">Ключові показники та те, що потребує уваги зараз.</p></div>{role==="ADMIN"&&<Link className="btn secondary" href="/admin/finance">Детальна аналітика</Link>}</div>
    {loading?<LoadingCard/>:error?<ErrorCard error={error}/>:data&&<div className="stack">
      <div className="grid cols-4">
        <StatCard label="Активні учні" value={data.metrics.active_students}/>
        <StatCard label="Викладачі" value={data.metrics.teachers}/>
        <StatCard label="Занять сьогодні" value={data.metrics.lessons_today}/>
        <StatCard label="Активні доступи до курсів" value={data.metrics.active_course_licenses}/>
      </div>

      <h2>Потребує уваги</h2>
      <div className="grid cols-4">
        <Link href={`/${base}/students?balance=LOW`}><StatCard label="≤ 3 занять" value={data.attention.low_balance}/></Link>
        <Link href={`/${base}/students?balance=ZERO`}><StatCard label="Баланс 0" value={data.attention.zero_balance}/></Link>
        <Link href={`/${base}/schedule`}><StatCard label="Броні без оплати" value={data.attention.booked_unpaid}/></Link>
        <Link href={`/${base}/schedule`}><StatCard label="Невідмічені уроки" value={data.attention.unmarked_lessons}/></Link>
        <Link href={`/${base}/vacations`}><StatCard label="Запити на відпустку" value={data.attention.pending_vacations}/></Link>
        <Link href={`/${base}/applications`}><StatCard label="Нові заявки" value={data.attention.new_leads}/></Link>
        {role==="ADMIN"&&<Link href="/admin/teachers"><StatCard label="Без реквізитів для виплат" value={data.attention.missing_payout_details}/></Link>}
        {role==="ADMIN"&&data.payrollWindow&&<Link href="/financier"><StatCard label="Виплати у поточному вікні" value={data.payrollWindow.pending_payouts}/></Link>}
      </div>

      {role==="ADMIN"&&data.finance&&<>
        <h2>Навчання · поточний місяць</h2>
        <div className="grid cols-4">
          <StatCard label="Проведено занять" value={data.learning.conducted}/>
          <StatCard label="Перші заняття" value={data.learning.first_conducted}/>
          <StatCard label="30-хв заняття" value={data.learning.thirty_minute}/>
          <StatCard label="Компенсаційні заняття" value={data.learning.compensation}/>
        </div>
        <p className="muted">Оплачений no-show рахується окремо ({data.learning.charged_no_show}) і не входить у кількість проведених занять.</p>

        <h2>Фінансовий контроль · поточний місяць</h2>
        <div className="grid cols-3">
          <StatCard label="Надходження" value={money(data.finance.month_revenue_minor)}/>
          <StatCard label="Нараховано викладачам" value={money(data.finance.month_teacher_accrual_minor)}/>
          <StatCard label="Різниця до інших витрат" value={money(data.finance.monthOperatingDifferenceMinor)}/>
        </div>
        <p className="muted">Це операційна різниця до податків, реклами, зарплат команди, інфраструктури та інших витрат — не чистий прибуток.</p>
        {data.payrollWindow&&<section className="card"><div className="row" style={{justifyContent:"space-between"}}><div><strong>Вікно виплат {data.payrollWindow.payout_window_start} — {data.payrollWindow.payout_window_end}</strong><div className="muted">Розрахунковий період {data.payrollWindow.period_start} — {data.payrollWindow.period_end}</div></div><div><strong>{money(data.payrollWindow.pending_amount_minor)}</strong><div className="muted">ще до виплати · {data.payrollWindow.pending_payouts} викладачів</div></div></div></section>}
      </>}
    </div>}
  </PlatformShell>;
}
