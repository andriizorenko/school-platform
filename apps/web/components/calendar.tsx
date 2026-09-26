"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { dateOnly, dateTime, lessonCount, phoneNumber, timeOnly } from "../lib/format";
import { SessionActions } from "./session-actions";

export type CalendarRole = "ADMIN" | "MANAGER" | "TEACHER" | "PARENT" | "STUDENT";
export type CalendarEvent = {
  id: string;
  startsAt?: string; starts_at?: string;
  endsAt?: string; ends_at?: string;
  sessionType?: string; session_type?: string;
  fundingStatus?: string; funding_status?: string;
  status?: string;
  needsReport?: boolean; needs_report?: boolean;
  student?: { id?: string; fullName?: string };
  studentFirstName?: string; student_first_name?: string;
  studentLastName?: string; student_last_name?: string;
  subject?: { id?: string; name?: string };
  subjectName?: string; subject_name?: string;
  teacher?: { id?: string; fullName?: string };
};

type SessionDetail = {
  id: string;
  student: { id: string; firstName: string; lastName: string; gradeLevel?: number | null };
  subject: { id: string; name: string };
  enrollmentId?: string | null;
  primaryTeacher: { id: string; firstName: string; lastName: string };
  actualTeacher: { id: string; firstName: string; lastName: string; phone?: string | null; zoomUrl?: string | null };
  parent?: { userId: string; firstName: string; lastName: string; phone?: string | null } | null;
  sessionType: "FIRST" | "REGULAR";
  fundingStatus: "PAID" | "BOOKED";
  status: string;
  startsAt: string;
  endsAt: string;
  topicTitle?: string | null;
  homeworkAssigned?: boolean | null;
  needsReport: boolean;
  balanceLessonUnits?: number | null;
  capabilities: { canMark: boolean; canReschedule: boolean; canReportIncident: boolean; canAssignSubstitute: boolean };
};

type FilterOptions = {
  teachers: Array<{ id: string; name: string }>;
  students: Array<{ id: string; name: string }>;
  subjects: Array<{ id: string; name: string }>;
  managers: Array<{ id: string; name: string }>;
};

type CalendarFilters = {
  teacherId: string;
  studentId: string;
  subjectId: string;
  managerId: string;
  sessionType: string;
  fundingStatus: string;
};

const EMPTY_FILTERS: CalendarFilters = {
  teacherId: "",
  studentId: "",
  subjectId: "",
  managerId: "",
  sessionType: "",
  fundingStatus: "",
};

function startOfWeek(date: Date) { const d = new Date(date); const day = (d.getDay() + 6) % 7; d.setHours(0,0,0,0); d.setDate(d.getDate()-day); return d; }
function addDays(date: Date, amount: number) { const d = new Date(date); d.setDate(d.getDate()+amount); return d; }
function dateParam(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function eventStart(e: CalendarEvent) { return e.startsAt ?? e.starts_at ?? ""; }
function eventEnd(e: CalendarEvent) { return e.endsAt ?? e.ends_at ?? ""; }
function studentName(e: CalendarEvent) { return e.student?.fullName ?? ([e.studentFirstName ?? e.student_first_name, e.studentLastName ?? e.student_last_name].filter(Boolean).join(" ") || "Учень"); }
function subjectName(e: CalendarEvent) { return e.subject?.name ?? e.subjectName ?? e.subject_name ?? "Предмет"; }
function sessionType(e: CalendarEvent) { return e.sessionType ?? e.session_type ?? "REGULAR"; }
function funding(e: CalendarEvent) { return e.fundingStatus ?? e.funding_status ?? "BOOKED"; }
function lifecycleStatus(e: CalendarEvent) { return (e.status ?? "").toUpperCase(); }

export function SchoolCalendar({ role, query = "" }: { role: CalendarRole; query?: string }) {
  const [anchor, setAnchor] = useState(() => new Date());
  const [mode, setMode] = useState<"day"|"week"|"month">("week");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [filters, setFilters] = useState<CalendarFilters>(EMPTY_FILTERS);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [filtersLoading, setFiltersLoading] = useState(false);
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const viewportResolved = useRef(false);
  const showGlobalFilters = role === "ADMIN" || role === "MANAGER";
  const fixedQuery = useMemo(() => new URLSearchParams(query), [query]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const apply = () => {
      if (!viewportResolved.current) {
        viewportResolved.current = true;
        setMode(media.matches ? "day" : "week");
        return;
      }
      setMode(current => media.matches ? (current === "month" ? "day" : current) : (current === "day" ? "week" : current));
    };
    apply(); media.addEventListener("change", apply); return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!showGlobalFilters) return;
    setFiltersLoading(true);
    api<FilterOptions>("/calendar/filter-options")
      .then(setFilterOptions)
      .catch((e: any) => setError(e?.message ?? "Не вдалося завантажити фільтри"))
      .finally(() => setFiltersLoading(false));
  }, [showGlobalFilters]);

  const range = useMemo(() => {
    if (mode === "day") {
      const day = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
      return { from: day, to: day };
    }
    if (mode === "month") {
      return {
        from: new Date(anchor.getFullYear(), anchor.getMonth(), 1),
        to: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0),
      };
    }
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 6) };
  }, [anchor, mode]);

  const effectiveQuery = useMemo(() => {
    const params = new URLSearchParams(query);
    (Object.entries(filters) as Array<[keyof CalendarFilters, string]>).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return params.toString();
  }, [filters, query]);

  async function loadEvents() {
    setError("");
    const params = new URLSearchParams(effectiveQuery);
    params.set("from", dateParam(range.from));
    params.set("to", dateParam(range.to));
    try {
      const data = await api<any>(`/calendar?${params.toString()}`);
      setEvents(Array.isArray(data) ? data : data.events ?? data.items ?? []);
    } catch (e: any) { setError(e.message ?? "Не вдалося завантажити календар"); }
  }
  useEffect(() => { void loadEvents(); }, [range.from.getTime(), range.to.getTime(), effectiveQuery]);

  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    setDetailLoading(true); setActionError("");
    api<SessionDetail>(`/sessions/${selected.id}`).then(setDetail).catch((e:any)=>setActionError(e.message)).finally(()=>setDetailLoading(false));
  }, [selected?.id]);

  const weekStart = startOfWeek(anchor);
  const monthDays = Math.ceil((range.to.getTime() - range.from.getTime()) / 86_400_000) + 1;
  const days = Array.from({ length: mode === "month" ? monthDays : 7 }, (_, i) => addDays(mode === "month" ? range.from : weekStart, i));
  const eventsFor = (d: Date) => events.filter(e => { const s = new Date(eventStart(e)); return s.getFullYear()===d.getFullYear() && s.getMonth()===d.getMonth() && s.getDate()===d.getDate(); }).sort((a,b)=>eventStart(a).localeCompare(eventStart(b)));
  const shift = (amount: number) => setAnchor(d => mode === "month" ? new Date(d.getFullYear(), d.getMonth()+amount, 1) : addDays(d, mode === "day" ? amount : amount*7));
  const teacherLabel = (event: CalendarEvent) => showGlobalFilters && event.teacher?.fullName ? ` · ${event.teacher.fullName}` : "";

  const eventClass = (e: CalendarEvent) => lifecycleStatus(e)==="COMPLETED"?"completed":lifecycleStatus(e)==="CHARGED_NO_SHOW"?"charged-no-show":lifecycleStatus(e)==="CANCELLED"?"cancelled":"";
  const card = (e: CalendarEvent) => <button key={e.id} className={`event ${eventClass(e)}`} onClick={()=>setSelected(e)}>
    <div className="event-time">{timeOnly(eventStart(e))}–{timeOnly(eventEnd(e))}</div>
    <div className="row" style={{marginTop:6}}><span className={`badge ${sessionType(e)==="FIRST"?"first":""}`}>{sessionType(e)==="FIRST"?"Перше":"Регулярне"}</span><span className={`badge ${funding(e).toLowerCase()}`}>{funding(e)==="PAID"?"Сплачено":"Бронь"}</span>{lifecycleStatus(e)==="COMPLETED"&&<span className="badge success-badge">Проведено</span>}{lifecycleStatus(e)==="CHARGED_NO_SHOW"&&<span className="badge charged-no-show-badge">Списано</span>}{lifecycleStatus(e)==="CANCELLED"&&<span className="badge cancelled-badge">Скасовано</span>}{(e.needsReport??e.needs_report) && <span className="badge report">ТРЕБА ЗВІТ</span>}</div>
    <div className="event-title">{studentName(e)}</div><div className="muted" style={{fontSize:12}}>{subjectName(e)}{teacherLabel(e)}</div>
  </button>;

  const compactLessonLabel = (e: CalendarEvent) => lifecycleStatus(e)==="CHARGED_NO_SHOW" ? "ПРОПУСК" : sessionType(e)==="FIRST" ? "Перший" : "Регулярний";
  const compactLessonClass = (e: CalendarEvent) => lifecycleStatus(e)==="CHARGED_NO_SHOW" ? "danger" : sessionType(e)==="FIRST" ? "first" : "regular";
  const compactCard = (e: CalendarEvent) => <button
    key={e.id}
    className={`event compact-week-event ${eventClass(e)} ${sessionType(e)==="FIRST" ? "first-lesson" : ""}`}
    onClick={()=>setSelected(e)}
    aria-label={`${timeOnly(eventStart(e))}–${timeOnly(eventEnd(e))}, ${studentName(e)}, ${subjectName(e)}, ${compactLessonLabel(e)}`}
  >
    <div className="compact-event-top">
      <strong>{timeOnly(eventStart(e))}-{timeOnly(eventEnd(e))}</strong>
      <div className="compact-event-meta">
        <span className={`compact-payment-dot ${funding(e).toLowerCase()}`} title={funding(e)==="PAID"?"Сплачено":"Бронь"} aria-label={funding(e)==="PAID"?"Сплачено":"Бронь"} />
        <span className={`compact-event-chip ${compactLessonClass(e)}`}>{compactLessonLabel(e)}</span>
      </div>
    </div>
    <div className="compact-event-student">{studentName(e)}</div>
    <div className="compact-event-bottom">
      <div className="compact-event-subject">{subjectName(e)}{teacherLabel(e)}</div>
      <div className="compact-event-indicators">
        {(e.needsReport??e.needs_report)&&<span className="compact-event-chip report">ЗВІТ</span>}
        {lifecycleStatus(e)==="COMPLETED"&&<span className="compact-completed-icon" title="Урок проведено" aria-label="Урок проведено">
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path d="m6.5 10 2.2 2.2 4.8-5"/></svg>
        </span>}
        {lifecycleStatus(e)==="CANCELLED"&&<span className="compact-event-chip muted">СКАС.</span>}
      </div>
    </div>
  </button>;

  function updateFilter(key: keyof CalendarFilters, value: string) {
    setFilters(current => ({ ...current, [key]: value }));
  }

  const fixedSessionType = fixedQuery.get("sessionType") ?? "";
  const fixedFundingStatus = fixedQuery.get("fundingStatus") ?? "";
  const todayKey = dateParam(new Date());
  const periodLabel = mode === "month"
    ? new Intl.DateTimeFormat("uk-UA", { month: "long", year: "numeric", timeZone: "Europe/Kyiv" }).format(anchor)
    : mode === "day"
      ? dateOnly(anchor)
      : `${dateOnly(range.from)} — ${dateOnly(range.to)}`;

  return <>
    {showGlobalFilters && <div className="card calendar-filters">
      <div className="calendar-filter-grid">
        <div className="field"><label>Викладач</label><select className="select" disabled={filtersLoading} value={filters.teacherId} onChange={e=>updateFilter("teacherId",e.target.value)}><option value="">Усі викладачі</option>{filterOptions?.teachers.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div className="field"><label>Учень</label><select className="select" disabled={filtersLoading} value={filters.studentId} onChange={e=>updateFilter("studentId",e.target.value)}><option value="">Усі учні</option>{filterOptions?.students.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div className="field"><label>Предмет</label><select className="select" disabled={filtersLoading} value={filters.subjectId} onChange={e=>updateFilter("subjectId",e.target.value)}><option value="">Усі предмети</option>{filterOptions?.subjects.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div className="field"><label>Основний менеджер</label><select className="select" disabled={filtersLoading} value={filters.managerId} onChange={e=>updateFilter("managerId",e.target.value)}><option value="">Усі менеджери</option>{filterOptions?.managers.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div className="field"><label>Тип заняття</label><select className="select" disabled={Boolean(fixedSessionType)} value={fixedSessionType || filters.sessionType} onChange={e=>updateFilter("sessionType",e.target.value)}><option value="">Усі</option><option value="FIRST">Перше</option><option value="REGULAR">Регулярне</option></select></div>
        <div className="field"><label>Статус оплати</label><select className="select" disabled={Boolean(fixedFundingStatus)} value={fixedFundingStatus || filters.fundingStatus} onChange={e=>updateFilter("fundingStatus",e.target.value)}><option value="">Усі</option><option value="PAID">Сплачено</option><option value="BOOKED">Бронь</option></select></div>
      </div>
      <div className="row calendar-filter-actions"><button type="button" className="btn secondary" onClick={()=>setFilters(EMPTY_FILTERS)}>Скинути фільтри</button><span className="muted">Знайдено занять: {events.length}</span></div>
    </div>}

    <div className="calendar-toolbar">
      <div className="row"><button className="btn secondary" onClick={()=>shift(-1)}>←</button><button className="btn secondary" onClick={()=>setAnchor(new Date())}>Сьогодні</button><button className="btn secondary" onClick={()=>shift(1)}>→</button></div>
      <strong className="calendar-period">{periodLabel}</strong>
      <div className="row calendar-modes desktop-modes"><button className={`btn ${mode==="day"?"":"secondary"}`} onClick={()=>setMode("day")}>День</button><button className={`btn ${mode==="week"?"":"secondary"}`} onClick={()=>setMode("week")}>Тиждень</button><button className={`btn ${mode==="month"?"":"secondary"}`} onClick={()=>setMode("month")}>Місяць</button></div>
      <div className="row calendar-modes mobile-modes"><button className={`btn ${mode==="day"?"":"secondary"}`} onClick={()=>setMode("day")}>День</button><button className={`btn ${mode==="week"?"":"secondary"}`} onClick={()=>setMode("week")}>Тиждень</button></div>
    </div>
    {error && <div className="error" style={{marginBottom:12}}>{error}</div>}

    {mode === "day" ? <div className="calendar-day"><h3>{dateOnly(anchor)}</h3>{eventsFor(anchor).length ? eventsFor(anchor).map(card) : <div className="empty">Немає занять</div>}</div> : mode === "month" ? <div className="calendar-month">{days.map(d => <div className={`calendar-month-day ${dateParam(d) === todayKey ? "today" : ""}`} key={dateParam(d)}><strong>{d.getDate()}</strong><div className="stack" style={{marginTop:8}}>{eventsFor(d).slice(0,3).map(card)}{eventsFor(d).length>3 && <span className="muted">+{eventsFor(d).length-3} ще</span>}</div></div>)}</div> : <>
      <div className="calendar-week">{days.map(d => {
        const dayEvents = eventsFor(d);
        const visibleEvents = dayEvents.slice(0, 5);
        return <section className={`calendar-day ${dateParam(d) === todayKey ? "today" : ""}`} key={dateParam(d)}>
          <div className="calendar-day-heading"><h3>{dateOnly(d)}</h3>{dayEvents.length>0&&<span className="calendar-day-count">{dayEvents.length}</span>}</div>
          {visibleEvents.length ? visibleEvents.map(compactCard) : <div className="muted calendar-day-empty">Немає занять</div>}
          {dayEvents.length>visibleEvents.length&&<button className="calendar-day-more" type="button" onClick={()=>{setAnchor(d);setMode("day")}}>Ще {dayEvents.length-visibleEvents.length} · відкрити день</button>}
        </section>;
      })}</div>
      <div className="mobile-day-nav">{days.map(d => <button key={dateParam(d)} onClick={()=>refs.current[dateParam(d)]?.scrollIntoView({behavior:"smooth",block:"start"})}>{new Intl.DateTimeFormat("uk-UA",{weekday:"short",timeZone:"Europe/Kyiv"}).format(d)}<br/><small>{d.getDate()}</small></button>)}</div>
      <div className="mobile-week-list">{days.map(d => <section className="card mobile-week-section" ref={el=>{refs.current[dateParam(d)]=el;}} key={dateParam(d)}><h3>{new Intl.DateTimeFormat("uk-UA",{weekday:"long",day:"2-digit",month:"2-digit",timeZone:"Europe/Kyiv"}).format(d)}</h3>{eventsFor(d).length ? eventsFor(d).map(card) : <div className="muted">Немає занять</div>}</section>)}</div>
    </>}

    {selected && <div className="sheet-backdrop" onClick={()=>setSelected(null)}><aside className="sheet" onClick={e=>e.stopPropagation()}><button className="sheet-close" onClick={()=>setSelected(null)}>×</button>{detailLoading?<div className="empty">Завантаження…</div>:detail?<div className="stack" style={{marginTop:40}}>
      <div><h2>{detail.student.lastName} {detail.student.firstName}</h2><p className="muted">{detail.student.gradeLevel?`${detail.student.gradeLevel} клас · `:""}{detail.subject.name}</p></div>
      <div><strong>{dateTime(detail.startsAt)}</strong><div className="muted">до {timeOnly(detail.endsAt)}</div></div>
      <div className="row"><span className={`badge ${detail.sessionType==="FIRST"?"first":""}`}>{detail.sessionType==="FIRST"?"Перше":"Регулярне"}</span><span className={`badge ${detail.fundingStatus.toLowerCase()}`}>{detail.fundingStatus==="PAID"?"Сплачено":"Бронь"}</span>{detail.status==="COMPLETED"&&<span className="badge success-badge">Проведено</span>}{detail.status==="CHARGED_NO_SHOW"&&<span className="badge charged-no-show-badge">Списано · пропуск</span>}{detail.status==="CANCELLED"&&<span className="badge cancelled-badge">Скасовано</span>}{detail.needsReport&&<span className="badge report">ТРЕБА ЗВІТ</span>}</div>
      {detail.balanceLessonUnits!==null&&detail.balanceLessonUnits!==undefined&&<div className="card compact-card"><div className="muted">Залишилось</div><strong>{lessonCount(detail.balanceLessonUnits)}</strong></div>}
      <div><div className="muted">Викладач</div><strong>{detail.actualTeacher.lastName} {detail.actualTeacher.firstName}</strong>{detail.actualTeacher.id!==detail.primaryTeacher.id&&<><span className="badge" style={{marginLeft:8}}>Заміна</span><div className="muted" style={{fontSize:12,marginTop:4}}>Основний: {detail.primaryTeacher.lastName} {detail.primaryTeacher.firstName}</div></>}{detail.actualTeacher.phone&&<div>{phoneNumber(detail.actualTeacher.phone)}</div>}</div>
      {detail.parent&&<div><div className="muted">Контакт батьків</div><strong>{detail.parent.lastName} {detail.parent.firstName}</strong>{detail.parent.phone&&<div><a href={`tel:${detail.parent.phone}`}>{phoneNumber(detail.parent.phone)}</a></div>}</div>}
      {detail.actualTeacher.zoomUrl&&<a className="btn" href={detail.actualTeacher.zoomUrl} target="_blank" rel="noreferrer">Приєднатися до Zoom</a>}
      {actionError&&<div className="error">{actionError}</div>}
      <SessionActions role={role} detail={detail} onSuccess={async()=>{await loadEvents();setSelected(null);}} />
    </div>:<div className="error">{actionError||"Не вдалося завантажити заняття"}</div>}</aside></div>}
  </>;
}
