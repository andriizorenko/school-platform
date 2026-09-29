"use client";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { PlatformShell } from "./platform-shell";
import { api } from "../lib/api";
import { useData } from "../lib/use-data";
import { dateTime } from "../lib/format";
import { ErrorCard, LoadingCard } from "./loadable";

type Setting={key:string;value:any;description?:string;category:string;value_type:string;unit?:string;min_numeric?:string|null;max_numeric?:string|null;is_critical:boolean;sort_order:number;updated_at:string};
const categoryLabels:Record<string,string>={GENERAL:"Загальні",SCHEDULING:"Розклад",LESSONS:"Заняття та правила",BILLING:"Оплати й баланс",REPORTS:"Звіти",AVAILABILITY:"Сезони доступності",NOTIFICATIONS:"Сповіщення",PAYROLL:"Виплати викладачам",COURSES:"Курси"};
const keyLabels:Record<string,string>={school_timezone:"Часовий пояс школи",parent_reschedule_cutoff_minutes:"Мінімальний час для перенесення батьками",teacher_mark_deadline_hours:"Вікно відмітки уроку викладачем",student_no_show_wait_minutes:"Очікування перед no-show",reservation_tail_days:"Тривалість броні після оплачених уроків",online_min_lesson_units:"Мінімальна онлайн-покупка",low_balance_lesson_units:"Поріг низького балансу",policy_clean_streak_reset:"Успішних уроків до скидання strike",report_request_min_lessons:"Мінімум уроків між звітами",school_year_start:"Початок навчального сезону",school_year_end:"Кінець навчального сезону",first_lesson_teacher_pay_minor:"Оплата викладачу за перший урок",lesson_reminder_minutes:"Нагадування до уроку",notification_planning_horizon_hours:"Горизонт планування сповіщень",unmarked_reminder_local_hour:"Година нагадування про невідмічений урок",notification_retry_max_attempts:"Максимум спроб Telegram",notification_retry_base_seconds:"Базова затримка повторної доставки",payroll_anchor_date:"Початок першого payroll-періоду",payroll_period_days:"Тривалість payroll-періоду",payroll_payout_window_days:"Вікно виплати",course_low_score_threshold_percent:"Поріг слабкого результату тесту",course_pdf_max_size_mb:"Максимальний PDF курсу"};

function displayValue(setting:Setting){if(setting.key==="first_lesson_teacher_pay_minor")return Number(setting.value)/100;return setting.value}
function apiValue(setting:Setting,value:string){if(setting.key==="first_lesson_teacher_pay_minor")return Math.round(Number(value)*100);if(["INTEGER","NUMBER"].includes(setting.value_type))return Number(value);return value}

export function SettingsPage(){
  const{data,error,loading,reload}=useData<Setting[]>("/settings");
  const[editing,setEditing]=useState<Setting|null>(null);
  const[saving,setSaving]=useState(false);
  const savingRef=useRef(false);
  const[value,setValue]=useState("");
  const[message,setMessage]=useState("");
  const[saveError,setSaveError]=useState("");
  const[historyKey,setHistoryKey]=useState<string|null>(null);
  const history=useData<any[]>(historyKey?`/settings/${encodeURIComponent(historyKey)}/history`:null);
  const groups=useMemo(()=>{const map=new Map<string,Setting[]>();for(const item of data??[]){const list=map.get(item.category)??[];list.push(item);map.set(item.category,list)}return [...map.entries()]},[data]);
  useEffect(()=>{
    if(!editing&&!historyKey)return;
    const previous=document.activeElement as HTMLElement|null;
    const sheet=document.querySelector<HTMLElement>(".settings-sheet");
    if(!sheet)return;
    sheet.focus();
    function onKeyDown(event:KeyboardEvent){
      if(event.key==="Escape"){
        event.preventDefault();
        if(!savingRef.current){setEditing(null);setHistoryKey(null)}
      }
      if(event.key!=="Tab"||!sheet)return;
      const controls=Array.from(sheet.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]'));
      const first=controls[0],last=controls[controls.length-1];
      if(!first){event.preventDefault();sheet.focus();return}
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===sheet)){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===sheet)){event.preventDefault();first.focus()}
    }
    sheet.addEventListener("keydown",onKeyDown);
    return ()=>{sheet.removeEventListener("keydown",onKeyDown);if(previous?.isConnected)previous.focus()};
  },[editing?.key,historyKey]);
  function begin(setting:Setting){setEditing(setting);setValue(String(displayValue(setting)));setSaveError("");setMessage("")}
  async function save(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!editing||savingRef.current)return;savingRef.current=true;event.currentTarget.focus();setSaving(true);setSaveError("");try{await api(`/settings/${encodeURIComponent(editing.key)}`,{method:"PATCH",body:JSON.stringify({value:apiValue(editing,value)})});setEditing(null);setMessage("Налаштування збережено й записано в журнал аудиту.");await reload()}catch(e:any){setSaveError(e.message)}finally{savingRef.current=false;setSaving(false)}}
  return <PlatformShell allowedRoles={["ADMIN"]}>
    <div className="page-head"><div><h1>Налаштування школи</h1><p className="muted">Критичні бізнес-правила школи. Значення перевіряються системою, а всі зміни записуються в журнал аудиту.</p></div></div>
    {message&&<div className="success" role="status" style={{marginBottom:12}}>{message}</div>}
    {loading?<div role="status"><LoadingCard/></div>:error?<div role="alert"><ErrorCard error={error}/></div>:!data?.length?<div className="card empty">Налаштувань поки немає.</div>:<div className="stack settings-list">{groups.map(([category,items])=><section className="card stack" key={category}><div><h2>{categoryLabels[category]??category}</h2></div>{items.map(setting=><div className="setting-row" key={setting.key}><div><div className="row"><strong>{keyLabels[setting.key]??setting.key}</strong>{setting.is_critical&&<span className="badge booked">Критичне</span>}</div></div><div className="setting-value"><strong>{setting.key==="first_lesson_teacher_pay_minor"?`${Number(setting.value)/100} ₴`:String(setting.value)} {setting.unit&&setting.key!=="first_lesson_teacher_pay_minor"?setting.unit:""}</strong><small className="muted">оновлено <time dateTime={setting.updated_at}>{dateTime(setting.updated_at)}</time></small></div><div className="row"><button className="btn secondary" onClick={()=>setHistoryKey(setting.key)}>Історія</button><button className="btn" onClick={()=>begin(setting)}>Змінити</button></div></div>)}</section>)}</div>}

    {editing&&<div className="sheet-backdrop" onMouseDown={()=>{if(!savingRef.current)setEditing(null)}}><form className="sheet stack settings-sheet" role="dialog" aria-modal="true" aria-labelledby="setting-title" tabIndex={-1} aria-busy={saving} onMouseDown={e=>e.stopPropagation()} onSubmit={save}><button type="button" className="sheet-close" aria-label="Закрити редагування налаштування" disabled={saving} onClick={()=>setEditing(null)}>×</button><div><h2 id="setting-title">{keyLabels[editing.key]??editing.key}</h2><p className="muted">{editing.description}</p></div>{editing.is_critical&&<div className="error">Це критичне правило. Зміна застосовуватиметься до майбутніх операцій і залишиться в audit log.</div>}{saveError&&<div className="error" id="setting-save-error" role="alert">{saveError}</div>}<div className="field"><label htmlFor="setting-value">Нове значення {editing.unit?`(${editing.unit})`:""}</label><input id="setting-value" className="input" disabled={saving} aria-invalid={Boolean(saveError)} aria-describedby={saveError?"setting-save-error":undefined} type={editing.value_type==="DATE"?"date":editing.value_type==="INTEGER"||editing.value_type==="NUMBER"?"number":"text"} step={editing.value_type==="NUMBER"?"any":"1"} min={editing.key==="first_lesson_teacher_pay_minor"?undefined:editing.min_numeric??undefined} max={editing.key==="first_lesson_teacher_pay_minor"?undefined:editing.max_numeric??undefined} value={value} onChange={e=>setValue(e.target.value)} required/></div>{editing.min_numeric!=null&&editing.key!=="first_lesson_teacher_pay_minor"&&<small className="muted">Допустимий діапазон: {editing.min_numeric} — {editing.max_numeric??"∞"} {editing.unit??""}</small>}<button className="btn" disabled={saving} type="submit">{saving?"Збереження…":"Зберегти"}</button></form></div>}

    {historyKey&&<div className="sheet-backdrop" onMouseDown={()=>setHistoryKey(null)}><div className="sheet wide-sheet stack settings-sheet" role="dialog" aria-modal="true" aria-labelledby="setting-history-title" tabIndex={-1} onMouseDown={e=>e.stopPropagation()}><button type="button" className="sheet-close" aria-label="Закрити історію змін" onClick={()=>setHistoryKey(null)}>×</button><h2 id="setting-history-title">Історія змін</h2><p className="muted">{keyLabels[historyKey]??historyKey}</p>{history.loading?<div role="status"><LoadingCard/></div>:history.error?<div role="alert"><ErrorCard error={history.error}/></div>:!history.data?.length?<div className="empty">Змін ще не було.</div>:history.data.map((row:any)=><div className="card compact-card" key={row.id}><div className="row" style={{justifyContent:"space-between"}}><strong>{row.actor_name??row.actor_email??row.actor_role_code??"System"}</strong><time className="muted" dateTime={row.created_at}>{dateTime(row.created_at)}</time></div><dl className="setting-history-values"><div><dt>Було</dt><dd tabIndex={0} aria-label="Попереднє значення">{JSON.stringify(row.before_data?.value)??"—"}</dd></div><div><dt>Стало</dt><dd tabIndex={0} aria-label="Нове значення">{JSON.stringify(row.after_data?.value)??"—"}</dd></div></dl></div>)}</div></div>}
  </PlatformShell>
}

