"use client";
import { PlatformShell } from "./platform-shell";
import { SchoolCalendar, type CalendarRole } from "./calendar";

export function CalendarPage({
  role,
  query = "",
  title = "Розклад",
  subtitle,
}: {
  role: CalendarRole;
  query?: string;
  title?: string;
  subtitle?: string;
}) {
  const allowed = role === "ADMIN" ? ["ADMIN", "SUPPORT_MANAGER"] : [role];
  const defaultSubtitle = role === "PARENT"
    ? "Єдиний календар усіх дітей і предметів."
    : role === "STUDENT"
      ? "Усі твої предмети в одному календарі."
      : role === "TEACHER"
        ? "Твої заняття в календарі на день, тиждень або місяць."
        : "Переглядайте та фільтруйте заняття школи за потрібний період.";

  return <PlatformShell allowedRoles={allowed}>
    <div className="page-head">
      <div><h1>{title}</h1><p className="muted">{subtitle ?? defaultSubtitle}</p></div>
    </div>
    <SchoolCalendar role={role} query={query}/>
  </PlatformShell>;
}
