"use client";

import { PlatformShell } from "./platform-shell";
import { useData } from "../lib/use-data";
import { ErrorCard, LoadingCard } from "./loadable";
import { dateTime } from "../lib/format";

export function AuditPage() {
  const { data, error, loading } = useData<any[]>("/ops/audit?limit=300");

  return <PlatformShell allowedRoles={["ADMIN", "SUPPORT_MANAGER"]}>
    <div className="page-head">
      <div>
        <h1>Журнал аудиту</h1>
        <p className="muted">Значущі зміни стану системи з першого дня.</p>
      </div>
    </div>

    {loading ? <LoadingCard /> : error ? <ErrorCard error={error} /> : !data?.length ? (
      <div className="card empty">Подій аудиту поки немає.</div>
    ) : (
      <div className="table-wrap">
        <table>
          <thead><tr><th>Час</th><th>Хто</th><th>Дія</th><th>Сутність</th><th>Зміни</th></tr></thead>
          <tbody>{data.map((item) => <tr key={item.id}>
            <td>{dateTime(item.created_at)}</td>
            <td>{item.actor_name || item.actor_email || "Система"}<br/><span className="muted">{item.actor_role}</span></td>
            <td><strong>{item.action}</strong></td>
            <td>{item.entity_type}</td>
            <td><details><summary>Переглянути</summary><pre className="audit-json">{JSON.stringify({ before: item.before_data, after: item.after_data }, null, 2)}</pre></details></td>
          </tr>)}</tbody>
        </table>
      </div>
    )}
  </PlatformShell>;
}
