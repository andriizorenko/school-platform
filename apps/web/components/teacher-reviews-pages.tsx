"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "../lib/api";
import { dateTime } from "../lib/format";
import { useData } from "../lib/use-data";
import { ErrorCard, LoadingCard } from "./loadable";
import { PlatformShell } from "./platform-shell";

type Opportunity = {
  session_id: string;
  teacher_first_name: string;
  teacher_last_name: string;
  student_first_name: string;
  student_last_name: string;
  subject_name: string;
  starts_at: string;
  review_id: string | null;
  review_status: "PENDING" | "APPROVED" | "REJECTED" | null;
};
type Review = {
  id: string;
  rating: number;
  comment: string;
  created_at: string;
  parent_first_name: string;
  parent_last_name: string;
  student_first_name: string;
  subject_name: string;
  teacher_first_name?: string;
  teacher_last_name?: string;
  student_last_name?: string;
  starts_at?: string;
};

function Stars({ rating }: { rating: number }) {
  return <span className="teacher-review-stars" aria-label={rating + " із 5 зірок"}>{"★".repeat(rating)}{"☆".repeat(5 - rating)}</span>;
}

export function ParentTeacherReviewsPage() {
  const { data, error, loading, reload } = useData<Opportunity[]>("/teacher-reviews/parent/opportunities");
  const [activeId, setActiveId] = useState("");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");

  async function submit(sessionId: string) {
    setBusy(true); setActionError(""); setMessage("");
    try {
      await api("/teacher-reviews", { method: "POST", body: JSON.stringify({ sessionId, rating, comment: comment.trim() }) });
      setMessage("Дякуємо! Відгук надіслано на модерацію.");
      setActiveId(""); setComment(""); setRating(5);
      await reload();
    } catch (cause: unknown) {
      setActionError(cause instanceof Error ? cause.message : "Не вдалося надіслати відгук");
    } finally {
      setBusy(false);
    }
  }

  return <PlatformShell allowedRoles={["PARENT"]}>
    <div className="page-head"><div><h1>Відгуки про викладачів</h1><p className="muted">Після проведеного уроку ви можете залишити один відгук про кожного викладача. Перед показом його перевіряє адміністратор.</p></div><Link className="btn secondary" href="/parent">На головну</Link></div>
    {message && <div className="success" role="status">{message}</div>}
    {actionError && <div className="error" role="alert">{actionError}</div>}
    {loading ? <LoadingCard /> : error ? <ErrorCard error={error} /> : !data?.length ? <div className="card empty">Викладачі для відгуку з’являться після проведеного уроку.</div> :
      <div className="grid cols-2 teacher-reviews-grid">{data.map((item) => <section className="card teacher-review-card" key={item.session_id}>
        <div className="teacher-dashboard-heading"><div><h2>{item.teacher_last_name} {item.teacher_first_name}</h2><p className="muted">{item.subject_name} · {item.student_first_name} {item.student_last_name}</p></div>{item.review_status && <span className="badge">{item.review_status === "PENDING" ? "На модерації" : item.review_status === "APPROVED" ? "Схвалено" : "Відхилено"}</span>}</div>
        <div className="muted">Останній проведений урок: {dateTime(item.starts_at)}</div>
        {!item.review_id && activeId !== item.session_id && <button type="button" className="btn secondary" onClick={() => { setActiveId(item.session_id); setActionError(""); }}>Залишити відгук</button>}
        {!item.review_id && activeId === item.session_id && <form className="stack teacher-review-form" onSubmit={(event) => { event.preventDefault(); void submit(item.session_id); }}>
          <label className="field"><span>Оцінка</span><select className="select" value={rating} onChange={(event) => setRating(Number(event.target.value))}>{[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} із 5</option>)}</select></label>
          <label className="field"><span>Ваш відгук</span><textarea className="textarea" required minLength={10} maxLength={1000} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Що було корисним у заняттях?" /></label>
          <div className="row"><button type="submit" className="btn" disabled={busy || comment.trim().length < 10}>{busy ? "Надсилаємо…" : "Надіслати на модерацію"}</button><button type="button" className="btn secondary" onClick={() => setActiveId("")}>Скасувати</button></div>
        </form>}
      </section>)}</div>}
  </PlatformShell>;
}

export function TeacherReviewsPage() {
  const { data, error, loading } = useData<Review[]>("/teacher-reviews/me");
  return <PlatformShell allowedRoles={["TEACHER"]}>
    <div className="page-head"><div><h1>Відгуки про мої уроки</h1><p className="muted">Тут з’являються відгуки батьків після перевірки адміністратором.</p></div><Link className="btn secondary" href="/teacher">На головну</Link></div>
    {loading ? <LoadingCard /> : error ? <ErrorCard error={error} /> : !data?.length ? <div className="card empty">Схвалених відгуків поки немає.</div> :
      <div className="grid cols-2 teacher-reviews-grid">{data.map((item) => <article className="card teacher-review-card" key={item.id}>
        <div className="teacher-dashboard-heading"><strong>{item.parent_first_name} {item.parent_last_name}</strong><Stars rating={item.rating} /></div>
        <p>{item.comment}</p><div className="muted">{item.subject_name} · {item.student_first_name} · {dateTime(item.created_at)}</div>
      </article>)}</div>}
  </PlatformShell>;
}

export function AdminTeacherReviewsPage() {
  const { data, error, loading, reload } = useData<Review[]>("/teacher-reviews/admin/pending");
  const [busyId, setBusyId] = useState("");
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");

  async function moderate(id: string, status: "APPROVED" | "REJECTED") {
    setBusyId(id); setActionError(""); setMessage("");
    try {
      await api("/teacher-reviews/admin/" + id, { method: "PATCH", body: JSON.stringify({ status }) });
      setMessage(status === "APPROVED" ? "Відгук схвалено." : "Відгук відхилено.");
      await reload();
    } catch (cause: unknown) {
      setActionError(cause instanceof Error ? cause.message : "Не вдалося обробити відгук");
    } finally {
      setBusyId("");
    }
  }

  return <PlatformShell allowedRoles={["ADMIN"]}>
    <div className="page-head"><div><h1>Модерація відгуків</h1><p className="muted">Перевірте текст та оцінку перед показом викладачу.</p></div></div>
    {message && <div className="success" role="status">{message}</div>}
    {actionError && <div className="error" role="alert">{actionError}</div>}
    {loading ? <LoadingCard /> : error ? <ErrorCard error={error} /> : !data?.length ? <div className="card empty">Немає відгуків на модерації.</div> :
      <div className="grid cols-2 teacher-reviews-grid">{data.map((item) => <article className="card teacher-review-card" key={item.id}>
        <div className="teacher-dashboard-heading"><div><h2>{item.teacher_last_name} {item.teacher_first_name}</h2><p className="muted">Від {item.parent_first_name} {item.parent_last_name} · {item.student_first_name} {item.student_last_name}</p></div><Stars rating={item.rating} /></div>
        <p>{item.comment}</p><div className="muted">{item.subject_name} · урок {item.starts_at ? dateTime(item.starts_at) : "—"} · відгук {dateTime(item.created_at)}</div>
        <div className="row"><button className="btn" disabled={Boolean(busyId)} onClick={() => void moderate(item.id, "APPROVED")}>Схвалити</button><button className="btn danger" disabled={Boolean(busyId)} onClick={() => void moderate(item.id, "REJECTED")}>Відхилити</button></div>
      </article>)}</div>}
  </PlatformShell>;
}
