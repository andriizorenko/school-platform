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

    {loading ? <div role="status"><LoadingCard /></div> : error ? <div role="alert"><ErrorCard error={error} /></div> : !data?.length ? (
      <div className="card empty">Подій аудиту поки немає.</div>
    ) : (
      <div className="table-wrap audit-table-wrap" role="region" aria-label="Події аудиту" tabIndex={0}>
        <table className="audit-table" aria-label="Журнал аудиту">
          <thead><tr><th scope="col">Час</th><th scope="col">Хто</th><th scope="col">Дія</th><th scope="col">Сутність</th><th scope="col">Зміни</th></tr></thead>
          <tbody>{data.map((item) => <tr key={item.id}>
            <td><time dateTime={item.created_at}>{dateTime(item.created_at)}</time></td>
            <td>{item.actor_name || item.actor_email || "Система"}<br/><span className="muted">{item.actor_role}</span></td>
            <td><strong>{item.action}</strong></td>
            <td>{item.entity_type}</td>
            <td><details><summary aria-label={`Переглянути зміни: ${item.action}, ${dateTime(item.created_at)}`}>Переглянути</summary><pre className="audit-json" tabIndex={0} role="region" aria-label="Дані до та після зміни">{JSON.stringify({ before: item.before_data, after: item.after_data }, null, 2)}</pre></details></td>
          </tr>)}</tbody>
        </table>
      </div>
    )}
  </PlatformShell>;
}

