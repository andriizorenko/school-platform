"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "../lib/api";
import { dateTime } from "../lib/format";
import { useData } from "../lib/use-data";
import { ErrorCard, LoadingCard } from "./loadable";
import { PlatformShell } from "./platform-shell";

type Reschedule = {
  id: string;
  session_id: string;
  from_start_at: string;
  to_start_at: string;
  created_at: string;
  student_first_name: string;
  student_last_name: string;
  subject_name: string;
};

type ReschedulePage = { items: Reschedule[]; nextCursor: string | null };

export function ParentReschedulesPage() {
  const { data, error, loading } = useData<ReschedulePage>("/parent/reschedules");
  const [additionalPages, setAdditionalPages] = useState<ReschedulePage[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");

  const items = [...(data?.items ?? []), ...additionalPages.flatMap((page) => page.items)];
  const nextCursor = additionalPages.length
    ? additionalPages[additionalPages.length - 1].nextCursor
    : data?.nextCursor;

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError("");
    try {
      const page = await api<ReschedulePage>(`/parent/reschedules?before=${encodeURIComponent(nextCursor)}`);
      setAdditionalPages((current) => [...current, page]);
    } catch (e) {
      setMoreError(e instanceof Error ? e.message : "Не вдалося завантажити історію");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <PlatformShell allowedRoles={["PARENT"]}>
      <div className="page-head">
        <div>
          <h1>Історія перенесень</h1>
          <p className="muted">Завершені перенесення занять усіх дітей вашої сімʼї.</p>
        </div>
      </div>

      {loading ? <LoadingCard /> : error ? <ErrorCard error={error} /> : data && (
        <div className="stack">
          {items.length ? items.map((item) => (
            <article className="card stack" key={item.id}>
              <div>
                <strong>{item.subject_name} · {item.student_first_name} {item.student_last_name}</strong>
                <div className="muted">Перенесено: {dateTime(item.created_at)}</div>
              </div>
              <div>Було: {dateTime(item.from_start_at)}</div>
              <div>Стало: {dateTime(item.to_start_at)}</div>
              <div>
                <Link className="btn secondary" href={`/parent/schedule?sessionId=${item.session_id}`}>Поточні деталі уроку</Link>
              </div>
            </article>
          )) : <div className="card empty">Перенесень ще не було.</div>}

          {moreError && <div className="error" role="alert">{moreError}</div>}
          {nextCursor && (
            <button className="btn secondary" type="button" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? "Завантажуємо…" : "Показати ще"}
            </button>
          )}
        </div>
      )}
    </PlatformShell>
  );
}
