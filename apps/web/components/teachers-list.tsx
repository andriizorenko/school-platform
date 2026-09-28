"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ErrorCard, LoadingCard } from "./loadable";
import { PlatformShell } from "./platform-shell";
import { useData } from "../lib/use-data";

const statusLabel: Record<string, string> = {
  ACTIVE: "Активний",
  INVITED: "Запрошений",
  ON_LEAVE: "У відпустці",
  ARCHIVED: "Архів",
  PENDING: "Очікує активації",
  SUSPENDED: "Заблокований",
};

export function TeachersList({ role }: { role: "ADMIN" | "MANAGER" }) {
  const { data, error, loading } = useData<any[]>("/teachers");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const allowed = role === "ADMIN" ? ["ADMIN", "SUPPORT_MANAGER"] : ["MANAGER"];

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter((teacher) => {
      if (q && !`${teacher.firstName} ${teacher.lastName} ${teacher.lastName} ${teacher.firstName} ${teacher.phone} ${teacher.email}`.toLowerCase().includes(q)) return false;
      if (status === "ALL") return true;
      if (status === "ARCHIVED") return teacher.teacherStatus === "ARCHIVED" || teacher.userStatus === "ARCHIVED";
      if (status === "SUSPENDED") return teacher.userStatus === "SUSPENDED";
      if (status === "PENDING") return teacher.userStatus === "PENDING" || teacher.teacherStatus === "INVITED";
      return teacher.teacherStatus === status && teacher.userStatus !== "SUSPENDED";
    });
  }, [data, search, status]);

  return (
    <PlatformShell allowedRoles={allowed}>
      <div className="page-head">
        <div>
          <h1>Викладачі</h1>
          <p className="muted">Контакти, предмети, активність і стан акаунта.</p>
        </div>
      </div>

      <div className="card teachers-filter-card">
        <div className="grid cols-2">
          <div className="field">
            <label htmlFor="teachers-search">Пошук</label>
            <input
              id="teachers-search"
              className="input"
              type="search"
              placeholder="ПІБ, телефон або email"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="teachers-status">Статус</label>
            <select
              id="teachers-status"
              className="select"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="ACTIVE">Активні</option>
              <option value="PENDING">Очікують активації</option>
              <option value="SUSPENDED">Заблоковані</option>
              <option value="ARCHIVED">Архів</option>
              <option value="ALL">Усі</option>
            </select>
          </div>
        </div>
      </div>

      {loading ? <LoadingCard /> : error ? <ErrorCard error={error} /> : (
        <div className="grid cols-3">
          {rows.map((teacher) => (
            <Link href={`/${role.toLowerCase()}/teachers/${teacher.userId}`} className="card teacher-list-card" key={teacher.userId}>
              <h2>{teacher.lastName} {teacher.firstName}</h2>
              <div className="muted">{teacher.phone}</div>
              <div className="muted">{teacher.email}</div>
              <div className="row teacher-list-subjects">
                {teacher.subjects.filter((subject: any) => subject.isActive).map((subject: any) => <span className="badge" key={subject.id}>{subject.name}</span>)}
              </div>
              <div className="row teacher-list-statuses">
                <span className={`badge ${teacher.teacherStatus === "ACTIVE" ? "paid" : "booked"}`}>{statusLabel[teacher.teacherStatus] ?? teacher.teacherStatus}</span>
                {teacher.userStatus !== "ACTIVE" && <span className="badge booked">{statusLabel[teacher.userStatus] ?? teacher.userStatus}</span>}
              </div>
            </Link>
          ))}
          {!rows.length && <div className="empty">Викладачів за цими фільтрами не знайдено.</div>}
        </div>
      )}
    </PlatformShell>
  );
}
