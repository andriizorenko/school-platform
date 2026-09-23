"use client";
import { PlatformShell } from "./platform-shell";
import { SchoolCalendar, type CalendarRole } from "./calendar";
export function CalendarPage({role,query=""}:{role:CalendarRole;query?:string}){
  const allowed=role==="ADMIN"?["ADMIN","SUPPORT_MANAGER"]:[role];
  return <PlatformShell allowedRoles={allowed}><div className="page-head"><div><h1>Розклад</h1><p className="muted">{role==="PARENT"?"Єдиний календар усіх дітей і предметів.":role==="STUDENT"?"Усі твої предмети в одному календарі.":"На компʼютері — тиждень/місяць, на телефоні — день/тиждень."}</p></div></div><SchoolCalendar role={role} query={query}/></PlatformShell>
}
