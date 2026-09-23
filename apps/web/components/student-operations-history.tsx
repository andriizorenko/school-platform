"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { dateTime, money } from "../lib/format";
import { ErrorCard, LoadingCard } from "./loadable";

const dayNames = ["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];

function lessonUnits(credits: number | string | null | undefined) {
  return Number(credits ?? 0) / 2;
}

function scheduleLabel(slots: any[]) {
  if (!slots?.length) return "Без регулярних слотів";
  return slots
    .map((slot) => `${dayNames[Number(slot.dayOfWeek)] ?? "?"} ${String(slot.startTime).slice(0, 5)} · ${slot.durationMinutes} хв`)
    .join(" · ");
}

function ledgerLabel(item: any) {
  const labels: Record<string, string> = {
    PURCHASE: "Покупка",
    TEACHER_COMPENSATION: "Компенсація викладача",
    TRANSFER_IN: "Перенесення від іншої дитини",
    MANUAL_ADJUSTMENT: "Ручне коригування",
    LESSON_COMPLETED: "Проведений урок",
    NO_SHOW_CHARGED: "Списаний no-show",
    TRANSFER_OUT: "Передано іншій дитині",
    WRITE_OFF: "Списання залишку",
  };
  return labels[item.type] ?? item.type;
}

export function StudentOperationsHistory({ studentId }: { studentId: string }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api<any>(`/students/${studentId}/operations-history`)
      .then(setData)
      .catch((value) => setError(value as Error))
      .finally(() => setLoading(false));
  }, [studentId]);

  if (loading) return <LoadingCard />;
  if (error) return <ErrorCard error={error} />;
  if (!data) return null;

  return <section className="stack operations-history" id="operations-history">
    <div className="page-head compact-page-head">
      <div>
        <h2>Історія та фінансова трасованість</h2>
        <p className="muted">Хто вів учня, які графіки діяли, звідки взявся баланс і які значущі зміни відбувалися.</p>
      </div>
    </div>

    <details className="card history-disclosure" open>
      <summary><strong>Primary manager · історія</strong></summary>
      <div className="table-wrap history-body">
        <table>
          <thead><tr><th>Менеджер</th><th>Початок</th><th>Завершення</th></tr></thead>
          <tbody>{data.managerAssignments?.map((item:any) => <tr key={item.id}>
            <td>{item.lastName} {item.firstName}</td>
            <td>{dateTime(item.startedAt)}</td>
            <td>{item.endedAt ? dateTime(item.endedAt) : <span className="badge success">Поточний</span>}</td>
          </tr>)}</tbody>
        </table>
        {!data.managerAssignments?.length && <div className="empty-inline">Менеджера ще не призначали.</div>}
      </div>
    </details>

    {data.enrollments?.map((enrollment:any) => <details className="card history-disclosure" key={enrollment.id} open>
      <summary>
        <strong>{enrollment.subjectName}</strong>
        <span className="badge">{enrollment.status}</span>
      </summary>
      <div className="history-body stack">
        <div className="grid cols-2">
          <div>
            <h3>Історія викладачів</h3>
            <div className="table-wrap"><table><thead><tr><th>Викладач</th><th>З</th><th>До</th></tr></thead><tbody>
              {enrollment.teacherAssignments?.map((item:any) => <tr key={item.id}><td>{item.lastName} {item.firstName}</td><td>{dateTime(item.startedAt)}</td><td>{item.endedAt ? dateTime(item.endedAt) : <span className="badge success">Поточний</span>}</td></tr>)}
            </tbody></table></div>
            {!enrollment.teacherAssignments?.length && <div className="empty-inline">Призначень ще немає.</div>}
          </div>
          <div>
            <h3>Версії графіка</h3>
            <div className="history-list">{enrollment.scheduleVersions?.map((version:any) => <div className="history-list-row" key={version.id}>
              <div><strong>{version.effectiveFrom}</strong>{version.effectiveUntil ? ` — ${version.effectiveUntil}` : " — дотепер"}</div>
              <div className="muted">{scheduleLabel(version.slots)}</div>
            </div>)}</div>
            {!enrollment.scheduleVersions?.length && <div className="empty-inline">Регулярного графіка ще немає.</div>}
          </div>
        </div>

        <div>
          <h3>Покупки / поповнення</h3>
          <div className="table-wrap"><table><thead><tr><th>Дата</th><th>Заняття</th><th>Базова ціна</th><th>Оплачено</th><th>Метод</th></tr></thead><tbody>
            {enrollment.purchases?.map((item:any) => <tr key={item.id}><td>{dateTime(item.paidAt ?? item.createdAt)}</td><td>+{item.lessonUnits}</td><td>{money(item.subtotalMinor, item.currency)}</td><td><strong>{money(item.totalMinor, item.currency)}</strong>{Number(item.discountMinor)>0 && <div className="muted">знижка {money(item.discountMinor,item.currency)}</div>}</td><td>{item.paymentMethod ?? item.source}</td></tr>)}
          </tbody></table></div>
          {!enrollment.purchases?.length && <div className="empty-inline">Поповнень ще немає.</div>}
        </div>

        <div>
          <h3>Ledger балансу</h3>
          <div className="table-wrap"><table><thead><tr><th>Дата</th><th>Операція</th><th>Зміна</th><th>Деталі</th></tr></thead><tbody>
            {enrollment.ledger?.map((item:any) => <tr key={`${item.direction}-${item.id}`}><td>{dateTime(item.createdAt)}</td><td>{ledgerLabel(item)}</td><td className={item.direction==="GRANT"?"positive-value":"negative-value"}>{item.direction==="GRANT"?"+":"−"}{lessonUnits(item.credits)} зан.</td><td>{item.restrictedTeacherId ? `Компенсація: ${item.restrictedTeacherLastName ?? ""} ${item.restrictedTeacherFirstName ?? ""}` : item.transferId ? "Пов’язано з перенесенням" : "—"}</td></tr>)}
          </tbody></table></div>
          {!enrollment.ledger?.length && <div className="empty-inline">Ledger ще порожній.</div>}
        </div>

        {!!enrollment.transfers?.length && <div>
          <h3>Перенесення між дітьми</h3>
          <div className="history-list">{enrollment.transfers.map((item:any) => <div className="history-list-row" key={item.id}>
            <div><strong>{lessonUnits(item.credits)} заняття</strong> · {item.fromStudentLastName} {item.fromStudentFirstName} → {item.toStudentLastName} {item.toStudentFirstName}</div>
            <div className="muted">{dateTime(item.createdAt)}{item.reason ? ` · ${item.reason}` : ""}</div>
          </div>)}</div>
        </div>}
      </div>
    </details>)}

    <details className="card history-disclosure">
      <summary><strong>Значущі системні події</strong><span className="muted">{data.activity?.length ?? 0}</span></summary>
      <div className="history-body history-list">{data.activity?.map((event:any) => <div className="history-list-row" key={event.id}>
        <div className="row history-event-head"><strong>{event.action}</strong><span className="badge">{event.entityType}</span></div>
        <div className="muted">{dateTime(event.createdAt)} · {event.actorName || event.actorEmail || "SYSTEM"}{event.actorRole ? ` · ${event.actorRole}` : ""}</div>
        <details className="audit-inline"><summary>Технічні зміни</summary><pre className="audit-json">{JSON.stringify({ before: event.beforeData, after: event.afterData }, null, 2)}</pre></details>
      </div>)}</div>
    </details>
  </section>;
}
