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
  lateNoticeCutoffMinutes: number;
  currentIncident?: {
    type: "STUDENT_NO_SHOW" | "TEACHER_LATE_CANCELLATION";
    outcome?: "RESCHEDULE_REQUIRED_NO_CHARGE" | "CHARGED_NO_SHOW" | "COMPENSATION_GRANTED" | null;
  } | null;
  balanceLessonUnits?: number | null;
  capabilities: { canMark: boolean; canReschedule: boolean; canRescheduleToPast: boolean; canUndoOutcome: boolean; canReportIncident: boolean; canAssignSubstitute: boolean };
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

type TeacherAvailabilityData = {
  teacherId: string;
  templates: Array<{
    season: "SCHOOL_YEAR" | "SUMMER";
    isActive: boolean;
    windows: Array<{ dayOfWeek: number; startTime: string; endTime: string }>;
  }>;
  exceptions: Array<{
    date: string;
    isUnavailableAllDay: boolean;
    windows: Array<{ startTime: string; endTime: string }>;
  }>;
  vacations: Array<{
    startsOn: string;
    endsOn: string;
    status: string;
  }>;
};

type ClockWindow = { start: number; end: number };
const MIN_BOOKABLE_LESSON_MINUTES = 30;

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
function clockMinutes(value: string) {
  const [hour, minute] = String(value).slice(0,5).split(":").map(Number);
  return hour * 60 + minute;
}
function clockLabel(value: number) {
  const safe = Math.max(0, Math.min(24 * 60, value));
  const hour = Math.floor(safe / 60);
  const minute = safe % 60;
  return `${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}`;
}
function intersectClockWindows(base: ClockWindow[], overlays: ClockWindow[]) {
  const result: ClockWindow[] = [];
  for (const left of base) {
    for (const right of overlays) {
      const start = Math.max(left.start, right.start);
      const end = Math.min(left.end, right.end);
      if (end > start) result.push({ start, end });
    }
  }
  return result.sort((a,b)=>a.start-b.start);
}
function subtractClockWindows(base: ClockWindow[], busy: ClockWindow[]) {
  let result = [...base];
  for (const block of busy) {
    const next: ClockWindow[] = [];
    for (const window of result) {
      if (block.end <= window.start || block.start >= window.end) {
        next.push(window);
        continue;
      }
      if (block.start > window.start) next.push({ start: window.start, end: Math.min(block.start, window.end) });
      if (block.end < window.end) next.push({ start: Math.max(block.end, window.start), end: window.end });
    }
    result = next;
  }
  return result.filter(item=>item.end>item.start).sort((a,b)=>a.start-b.start);
}

export function SchoolCalendar({ role, query = "" }: { role: CalendarRole; query?: string }) {
  const [anchor, setAnchor] = useState(() => new Date());
  const [mode, setMode] = useState<"day"|"week"|"month">("week");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [reportReminder, setReportReminder] = useState<{ studentId: string; studentName: string } | null>(null);
  const [filters, setFilters] = useState<CalendarFilters>(EMPTY_FILTERS);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [filtersLoading, setFiltersLoading] = useState(false);
  const [teacherAvailability, setTeacherAvailability] = useState<TeacherAvailabilityData | null>(null);
  const [availabilityError, setAvailabilityError] = useState("");
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

  useEffect(() => {
    if (role !== "TEACHER") {
      setTeacherAvailability(null);
      setAvailabilityError("");
      return;
    }
    let active = true;
    setAvailabilityError("");
    api<{ user: { id: string } }>("/auth/me")
      .then((me) => api<TeacherAvailabilityData>(`/teachers/${me.user.id}/availability`))
      .then((availability) => { if (active) setTeacherAvailability(availability); })
      .catch((e: any) => {
        if (!active) return;
        setTeacherAvailability(null);
        setAvailabilityError(e?.message ?? "Не вдалося завантажити доступні години");
      });
    return () => { active = false; };
  }, [role]);

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

  const teacherFreeWindowsFor = (d: Date) => {
    if (role !== "TEACHER" || !teacherAvailability) return null;
    const date = dateParam(d);
    const approvedVacation = teacherAvailability.vacations?.find((item) =>
      item.status === "APPROVED" && item.startsOn <= date && item.endsOn >= date,
    );
    if (approvedVacation) return { kind: "VACATION" as const, windows: [] as ClockWindow[] };

    const season: "SCHOOL_YEAR" | "SUMMER" = d.getMonth() >= 5 && d.getMonth() <= 7 ? "SUMMER" : "SCHOOL_YEAR";
    const dayOfWeek = ((d.getDay() + 6) % 7) + 1;
    const template = teacherAvailability.templates?.find((item) => item.season === season && item.isActive);
    let available: ClockWindow[] = (template?.windows ?? [])
      .filter((window) => Number(window.dayOfWeek) === dayOfWeek)
      .map((window) => ({ start: clockMinutes(window.startTime), end: clockMinutes(window.endTime) }))
      .filter((window) => window.end > window.start);

    const exception = teacherAvailability.exceptions?.find((item) => item.date === date);
    if (exception?.isUnavailableAllDay) return { kind: "UNAVAILABLE" as const, windows: [] as ClockWindow[] };
    if (exception?.windows?.length) {
      const exceptionWindows = exception.windows
        .map((window) => ({ start: clockMinutes(window.startTime), end: clockMinutes(window.endTime) }))
        .filter((window) => window.end > window.start);
      available = intersectClockWindows(available, exceptionWindows);
    }

    if (!available.length) return { kind: "UNAVAILABLE" as const, windows: [] as ClockWindow[] };

    const busy = eventsFor(d)
      .filter((event) => !["CANCELLED","EXPIRED_UNPAID"].includes(lifecycleStatus(event)))
      .map((event) => ({ start: clockMinutes(timeOnly(eventStart(event))), end: clockMinutes(timeOnly(eventEnd(event))) }))
      .filter((window) => window.end > window.start);

    return { kind: "AVAILABLE" as const, windows: subtractClockWindows(available, busy).filter((window) => window.end - window.start >= MIN_BOOKABLE_LESSON_MINUTES) };
  };

  const availabilityLine = (d: Date) => {
    const availability = teacherFreeWindowsFor(d);
    if (!availability) return null;
    if (availability.kind === "VACATION") return <div className="teacher-availability-line unavailable"><span className="teacher-availability-dot"/><span>Відпустка</span></div>;
    if (availability.kind === "UNAVAILABLE") return <div className="teacher-availability-line unavailable"><span className="teacher-availability-dot"/><span>Недоступний</span></div>;
    if (!availability.windows.length) return <div className="teacher-availability-line busy"><span className="teacher-availability-dot"/><span>Вільних годин немає</span></div>;
    return <div className="teacher-availability-line" title="Доступні години з урахуванням уже запланованих занять">
      <span className="teacher-availability-dot"/>
      <span><strong>Доступно:</strong> {availability.windows.map((window)=>`${clockLabel(window.start)}–${clockLabel(window.end)}`).join(", ")}</span>
    </div>;
  };

  const eventClass = (e: CalendarEvent) => lifecycleStatus(e)==="COMPLETED"?"completed":lifecycleStatus(e)==="CHARGED_NO_SHOW"?"charged-no-show":lifecycleStatus(e)==="CANCELLED"?"cancelled":"";
  const card = (e: CalendarEvent) => <button key={e.id} className={`event ${eventClass(e)}`} onClick={()=>setSelected(e)}>
    <div className="event-time">{timeOnly(eventStart(e))}–{timeOnly(eventEnd(e))}</div>
    <div className="row" style={{marginTop:6}}><span className={`badge ${sessionType(e)==="FIRST"?"first":""}`}>{sessionType(e)==="FIRST"?"Перше":"Регулярне"}</span><span className={`badge ${funding(e).toLowerCase()}`}>{funding(e)==="PAID"?"Сплачено":"Бронь"}</span>{lifecycleStatus(e)==="COMPLETED"&&<span className="badge success-badge">Проведено</span>}{lifecycleStatus(e)==="CHARGED_NO_SHOW"&&<span className="badge charged-no-show-badge">Списано</span>}{lifecycleStatus(e)==="CANCELLED"&&<span className="badge cancelled-badge">Скасовано</span>}{(e.needsReport??e.needs_report) && <span className="badge report">ТРЕБА ЗВІТ</span>}</div>
    <div className="event-title">{studentName(e)}</div><div className="muted" style={{fontSize:12}}>{subjectName(e)}{teacherLabel(e)}</div>
  </button>;

  const compactLessonLabel = (e: CalendarEvent) => lifecycleStatus(e)==="CHARGED_NO_SHOW" ? "Пропуск" : sessionType(e)==="FIRST" ? "Перший" : "Регулярний";
  const compactLessonClass = (e: CalendarEvent) => lifecycleStatus(e)==="CHARGED_NO_SHOW" ? "danger" : sessionType(e)==="FIRST" ? "first" : "regular";
  const compactCard = (e: CalendarEvent) => <button
    key={e.id}
    className={`event compact-week-event ${eventClass(e)} ${sessionType(e)==="FIRST" ? "first-lesson" : ""}`}
    onClick={()=>setSelected(e)}
    aria-label={`${timeOnly(eventStart(e))}–${timeOnly(eventEnd(e))}, ${studentName(e)}, ${subjectName(e)}, ${compactLessonLabel(e)}`}
  >
    <div className="compact-event-top">
      <strong>{timeOnly(eventStart(e))}–{timeOnly(eventEnd(e))}</strong>
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

  const timelineRangeFor = (scopeDays: Date[]) => {
    const intervals: ClockWindow[] = [];
    for (const day of scopeDays) {
      const availability = teacherFreeWindowsFor(day);
      if (availability?.kind === "AVAILABLE") intervals.push(...availability.windows);
      for (const event of eventsFor(day)) {
        const start = clockMinutes(timeOnly(eventStart(event)));
        const end = clockMinutes(timeOnly(eventEnd(event)));
        if (end > start) intervals.push({ start, end });
      }
    }
    if (!intervals.length) return { start: 8 * 60, end: 20 * 60 };
    const start = Math.max(0, Math.floor(Math.min(...intervals.map((item)=>item.start)) / 60) * 60);
    const end = Math.min(24 * 60, Math.ceil(Math.max(...intervals.map((item)=>item.end)) / 60) * 60);
    return end > start ? { start, end } : { start, end: Math.min(24 * 60, start + 60) };
  };

  const timelineBlockStyle = (window: ClockWindow, timeline: ClockWindow) => {
    const start = Math.max(window.start, timeline.start);
    const end = Math.min(window.end, timeline.end);
    const span = Math.max(1, timeline.end - timeline.start);
    return {
      top: `${((start - timeline.start) / span) * 100}%`,
      height: `${Math.max(0, ((end - start) / span) * 100)}%`,
    };
  };

  const timelineLesson = (e: CalendarEvent, timeline: ClockWindow) => {
    const lessonWindow = {
      start: clockMinutes(timeOnly(eventStart(e))),
      end: clockMinutes(timeOnly(eventEnd(e))),
    };
    return <button
      key={e.id}
      className={`event compact-week-event teacher-timeline-lesson ${eventClass(e)} ${sessionType(e)==="FIRST"?"first-lesson":""}`}
      style={timelineBlockStyle(lessonWindow, timeline)}
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
  };

  const timelineDay = (d: Date, timeline: ClockWindow, variant: "week" | "day" = "week") => {
    const availability = teacherFreeWindowsFor(d);
    const dayEvents = eventsFor(d);
    const spanHours = Math.max(1, (timeline.end - timeline.start) / 60);
    const height = Math.max(300, Math.min(960, spanHours * 64));
    return <section className={`teacher-timeline-day ${variant==="day"?"teacher-timeline-day-wide":""} ${dateParam(d)===todayKey?"today":""}`} key={dateParam(d)}>
      <div className="calendar-day-heading">
        <h3>{dateOnly(d)}</h3>
        {dayEvents.length>0&&<span className="calendar-day-count">{dayEvents.length}</span>}
      </div>
      <div className="teacher-timeline-range">{clockLabel(timeline.start)}–{clockLabel(timeline.end)}</div>
      <div
        className="teacher-timeline-track"
        style={{height:`${height}px`,backgroundSize:`100% ${height/spanHours}px`}}
      >
        {availability?.kind==="AVAILABLE"&&availability.windows.map((window,index)=><div
          className="teacher-free-block"
          key={`free-${dateParam(d)}-${index}`}
          style={timelineBlockStyle(window,timeline)}
          title={`Вільно ${clockLabel(window.start)}–${clockLabel(window.end)}`}
        >
          <span>{clockLabel(window.start)}–{clockLabel(window.end)}</span>
          <strong>Вільно</strong>
        </div>)}
        {availability?.kind==="VACATION"&&<div className="teacher-timeline-status">Відпустка</div>}
        {availability?.kind==="UNAVAILABLE"&&<div className="teacher-timeline-status">Недоступний</div>}
        {dayEvents.map((event)=>timelineLesson(event,timeline))}
      </div>
    </section>;
  };

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
    {availabilityError && role === "TEACHER" && <div className="error" style={{marginBottom:12}}>{availabilityError}</div>}

    {mode === "day" ? (
      role === "TEACHER" && teacherAvailability
        ? <div className="teacher-day-timeline">{timelineDay(anchor,timelineRangeFor([anchor]),"day")}</div>
        : <div className="calendar-day"><h3>{dateOnly(anchor)}</h3>{availabilityLine(anchor)}{eventsFor(anchor).length ? eventsFor(anchor).map(card) : <div className="empty">Немає занять</div>}</div>
    ) : mode === "month" ? <div className="calendar-month">{days.map(d => <div className={`calendar-month-day ${dateParam(d) === todayKey ? "today" : ""}`} key={dateParam(d)}><strong>{d.getDate()}</strong><div className="stack" style={{marginTop:8}}>{eventsFor(d).slice(0,3).map(card)}{eventsFor(d).length>3 && <span className="muted">+{eventsFor(d).length-3} ще</span>}</div></div>)}</div> : <>
      {role === "TEACHER" && teacherAvailability ? <div className="teacher-week-timeline">{days.map(d=>timelineDay(d,timelineRangeFor(days)))}</div> : <div className="calendar-week">{days.map(d => {
        const dayEvents = eventsFor(d);
        const visibleEvents = dayEvents.slice(0, 5);
        return <section className={`calendar-day ${dateParam(d) === todayKey ? "today" : ""}`} key={dateParam(d)}>
          <div className="calendar-day-heading"><h3>{dateOnly(d)}</h3>{dayEvents.length>0&&<span className="calendar-day-count">{dayEvents.length}</span>}</div>
          {visibleEvents.length ? visibleEvents.map(compactCard) : <div className="muted calendar-day-empty">Немає занять</div>}
          {dayEvents.length>visibleEvents.length&&<button className="calendar-day-more" type="button" onClick={()=>{setAnchor(d);setMode("day")}}>Ще {dayEvents.length-visibleEvents.length} · відкрити день</button>}
        </section>;
      })}</div>}
      <div className="mobile-day-nav">{days.map(d => <button key={dateParam(d)} onClick={()=>refs.current[dateParam(d)]?.scrollIntoView({behavior:"smooth",block:"start"})}>{new Intl.DateTimeFormat("uk-UA",{weekday:"short",timeZone:"Europe/Kyiv"}).format(d)}<br/><small>{d.getDate()}</small></button>)}</div>
      <div className="mobile-week-list">{days.map(d => <section className="card mobile-week-section" ref={el=>{refs.current[dateParam(d)]=el;}} key={dateParam(d)}><h3>{new Intl.DateTimeFormat("uk-UA",{weekday:"long",day:"2-digit",month:"2-digit",timeZone:"Europe/Kyiv"}).format(d)}</h3>{availabilityLine(d)}{eventsFor(d).length ? eventsFor(d).map(card) : <div className="muted">Немає занять</div>}</section>)}</div>
    </>}

    {reportReminder && <div className="report-reminder-backdrop">
      <section className="report-reminder-modal" role="dialog" aria-modal="true" aria-labelledby="report-reminder-title">
        <div className="report-reminder-icon" aria-hidden="true">!</div>
        <div>
          <h3 id="report-reminder-title">Не забудь про звіт</h3>
          <p>Урок із {reportReminder.studentName} відмічено. Батьки очікують звіт про успішність за цим заняттям.</p>
        </div>
        <div className="report-reminder-actions">
          <button type="button" className="btn secondary" onClick={()=>setReportReminder(null)}>Гаразд</button>
          <button type="button" className="btn" onClick={()=>{
            const studentId = reportReminder.studentId;
            setReportReminder(null);
            window.location.assign(`/teacher/students/${studentId}#pending-reports`);
          }}>Заповнити зараз</button>
        </div>
      </section>
    </div>}

    {selected && <div className="sheet-backdrop" onClick={()=>setSelected(null)}><aside className="sheet" onClick={e=>e.stopPropagation()}><button className="sheet-close" onClick={()=>setSelected(null)}>×</button>{detailLoading?<div className="empty">Завантаження…</div>:detail?<div className="stack" style={{marginTop:40}}>
      <div><h2>{detail.student.lastName} {detail.student.firstName}</h2><p className="muted">{detail.student.gradeLevel?`${detail.student.gradeLevel} клас · `:""}{detail.subject.name}</p></div>
      <div><strong>{dateTime(detail.startsAt)}</strong><div className="muted">до {timeOnly(detail.endsAt)}</div></div>
      <div className="row"><span className={`badge ${detail.sessionType==="FIRST"?"first":""}`}>{detail.sessionType==="FIRST"?"Перше":"Регулярне"}</span><span className={`badge ${detail.fundingStatus.toLowerCase()}`}>{detail.fundingStatus==="PAID"?"Сплачено":"Бронь"}</span>{detail.status==="COMPLETED"&&<span className="badge success-badge">Проведено</span>}{detail.status==="CHARGED_NO_SHOW"&&<span className="badge charged-no-show-badge">Списано · пропуск</span>}{detail.status==="CANCELLED"&&<span className="badge cancelled-badge">Скасовано</span>}{detail.needsReport&&<span className="badge report">ТРЕБА ЗВІТ</span>}</div>
      {detail.balanceLessonUnits!==null&&detail.balanceLessonUnits!==undefined&&<div className="card compact-card"><div className="muted">Залишилось</div><strong>{lessonCount(detail.balanceLessonUnits)}</strong></div>}
      <div><div className="muted">Викладач</div><strong>{detail.actualTeacher.lastName} {detail.actualTeacher.firstName}</strong>{detail.actualTeacher.id!==detail.primaryTeacher.id&&<><span className="badge" style={{marginLeft:8}}>Заміна</span><div className="muted" style={{fontSize:12,marginTop:4}}>Основний: {detail.primaryTeacher.lastName} {detail.primaryTeacher.firstName}</div></>}{detail.actualTeacher.phone&&<div>{phoneNumber(detail.actualTeacher.phone)}</div>}</div>
      {detail.parent&&<div><div className="muted">Контакт батьків</div><strong>{detail.parent.lastName} {detail.parent.firstName}</strong>{detail.parent.phone&&<div><a href={`tel:${detail.parent.phone}`}>{phoneNumber(detail.parent.phone)}</a></div>}</div>}
      {detail.actualTeacher.zoomUrl&&<a className="btn" href={detail.actualTeacher.zoomUrl} target="_blank" rel="noreferrer">Приєднатися до Zoom</a>}
      {actionError&&<div className="error">{actionError}</div>}
      <SessionActions
        role={role}
        detail={detail}
        onReportReminder={(studentId) => setReportReminder({
          studentId,
          studentName: `${detail.student.firstName} ${detail.student.lastName}`,
        })}
        onSuccess={async()=>{await loadEvents();setSelected(null);}}
      />
    </div>:<div className="error">{actionError||"Не вдалося завантажити заняття"}</div>}</aside></div>}
  </>;
}
