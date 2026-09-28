"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { lessonCount, phoneNumber } from "../lib/format";
import { useData } from "../lib/use-data";
import { ErrorCard, LoadingCard } from "./loadable";
import { NewStudentWizard } from "./new-student-wizard";
import { PlatformShell } from "./platform-shell";

export function StudentsList({ role }: { role: "ADMIN" | "MANAGER" | "TEACHER" }) {
  const [search, setSearch] = useState("");
  const [balance, setBalance] = useState("");
  const [lifecycle, setLifecycle] = useState("ACTIVE");
  const [mine, setMine] = useState(role === "MANAGER");

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (balance) params.set("balance", balance);
    if (lifecycle) params.set("lifecycle", lifecycle);
    if (mine) params.set("manager", "mine");
    return `/ops/students?${params}`;
  }, [search, balance, lifecycle, mine]);

  const { data, error, loading, reload } = useData<any[]>(query);
  const base = role.toLowerCase();
  const allowed = role === "ADMIN" ? ["ADMIN", "SUPPORT_MANAGER"] : [role];

  return (
    <PlatformShell allowedRoles={allowed}>
      <div className="page-head">
        <div>
          <h1>{role === "TEACHER" ? "Мої учні" : "Учні"}</h1>
          <p className="muted">Пошук, предмети, викладачі та залишок занять.</p>
        </div>
        {role !== "TEACHER" && <NewStudentWizard role={role} onDone={reload} />}
      </div>

      <div className="card row wrap-row students-filter-card">
        <div className="field students-filter-search">
          <label htmlFor="students-search">Пошук</label>
          <input
            id="students-search"
            className="input"
            type="search"
            placeholder="Імʼя, прізвище або телефон"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="field students-filter-select">
          <label htmlFor="students-balance">Баланс</label>
          <select
            id="students-balance"
            className="select"
            value={balance}
            onChange={(event) => setBalance(event.target.value)}
          >
            <option value="">Будь-який баланс</option>
            <option value="LOW">1–3 заняття</option>
            <option value="ZERO">0 занять</option>
            <option value="POSITIVE">Більше 3</option>
          </select>
        </div>

        {role !== "TEACHER" && (
          <div className="field students-filter-select">
            <label htmlFor="students-lifecycle">Статус</label>
            <select
              id="students-lifecycle"
              className="select"
              value={lifecycle}
              onChange={(event) => setLifecycle(event.target.value)}
            >
              <option value="ACTIVE">Активні</option>
              <option value="ARCHIVED">Архів</option>
              <option value="ALL">Усі</option>
            </select>
          </div>
        )}

        {role === "MANAGER" && (
          <label className="row students-filter-mine">
            <input
              type="checkbox"
              checked={mine}
              onChange={(event) => setMine(event.target.checked)}
            />
            <span>Тільки мої учні</span>
          </label>
        )}
      </div>

      {loading ? <LoadingCard /> : error ? <ErrorCard error={error} /> : (
        <div className="table-wrap">
          <table className="students-table">
            <thead>
              <tr>
                <th>Учень</th>
                <th>Клас</th>
                <th>Батьки</th>
                <th>Предмети</th>
                <th>Менеджер</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((student: any) => (
                <tr key={student.id}>
                  <td>
                    <Link href={`/${base}/students/${student.id}`}>
                      <strong>{student.last_name} {student.first_name}</strong>
                    </Link>
                    {student.archived_at && <div><span className="badge">В архіві</span></div>}
                  </td>
                  <td>{student.grade_level ? `${student.grade_level} клас` : "—"}</td>
                  <td>
                    {student.parent_last_name} {student.parent_first_name}
                    <br />
                    <span className="muted">{phoneNumber(student.parent_phone)}</span>
                  </td>
                  <td>
                    {(student.enrollments ?? []).map((enrollment: any) => (
                      <div key={enrollment.id}>
                        {enrollment.subjectName}: {lessonCount(enrollment.balanceLessonUnits)} · {enrollment.teacherName || "без викладача"}
                      </div>
                    ))}
                  </td>
                  <td>{student.manager_last_name ? `${student.manager_last_name} ${student.manager_first_name}` : "—"}</td>
                </tr>
              ))}
              {!data?.length && (
                <tr>
                  <td colSpan={5}><div className="empty">Нічого не знайдено</div></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </PlatformShell>
  );
}
