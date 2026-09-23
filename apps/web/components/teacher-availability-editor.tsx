"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

const dayNames = ["", "Понеділок", "Вівторок", "Середа", "Четвер", "Пʼятниця", "Субота", "Неділя"];
const shortDayNames = ["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];

type Season = "SCHOOL_YEAR" | "SUMMER";
type Window = { dayOfWeek: number; startTime: string; endTime: string };
type ExceptionWindow = { startTime: string; endTime: string };

function shortTime(value: string) {
  return String(value).slice(0, 5);
}

function minutes(value: string) {
  const [hour, minute] = shortTime(value).split(":").map(Number);
  return hour * 60 + minute;
}

function intervalStyle(startTime: string, endTime: string) {
  const visibleStart = 6 * 60;
  const visibleEnd = 24 * 60;
  const start = Math.max(visibleStart, minutes(startTime));
  const end = Math.min(visibleEnd, minutes(endTime));
  const span = visibleEnd - visibleStart;
  return {
    left: `${((start - visibleStart) / span) * 100}%`,
    width: `${Math.max(2, ((end - start) / span) * 100)}%`,
  };
}

export function TeacherAvailabilityEditor({
  teacherId,
  title = "Вільні години",
  compact = false,
}: {
  teacherId: string;
  title?: string;
  compact?: boolean;
}) {
  const [data, setData] = useState<any>(null);
  const [season, setSeason] = useState<Season>("SCHOOL_YEAR");
  const [windows, setWindows] = useState<Window[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copySourceDay, setCopySourceDay] = useState(1);
  const [copyTargets, setCopyTargets] = useState<number[]>([3, 5]);

  const [exceptionDate, setExceptionDate] = useState("");
  const [exceptionAllDay, setExceptionAllDay] = useState(true);
  const [exceptionWindows, setExceptionWindows] = useState<ExceptionWindow[]>([{ startTime: "10:00", endTime: "18:00" }]);

  async function load() {
    setError("");
    try {
      const availability = await api<any>(`/teachers/${teacherId}/availability`);
      setData(availability);
      const template = availability.templates?.find((item: any) => item.season === season);
      setWindows((template?.windows ?? []).map((window: any) => ({
        dayOfWeek: Number(window.dayOfWeek),
        startTime: shortTime(window.startTime),
        endTime: shortTime(window.endTime),
      })));
    } catch (exception: any) {
      setError(exception?.message ?? "Не вдалося завантажити доступність");
    }
  }

  useEffect(() => { void load(); }, [teacherId]);
  useEffect(() => {
    if (!data) return;
    const template = data.templates?.find((item: any) => item.season === season);
    setWindows((template?.windows ?? []).map((window: any) => ({
      dayOfWeek: Number(window.dayOfWeek),
      startTime: shortTime(window.startTime),
      endTime: shortTime(window.endTime),
    })));
  }, [season, data]);

  const grouped = useMemo(() => Object.fromEntries(
    Array.from({ length: 7 }, (_, index) => [
      index + 1,
      windows
        .map((window, originalIndex) => ({ window, originalIndex }))
        .filter(({ window }) => window.dayOfWeek === index + 1),
    ]),
  ), [windows]);

  function add(day: number) {
    const dayWindows = windows.filter((window) => window.dayOfWeek === day);
    const last = dayWindows[dayWindows.length - 1];
    const nextStart = last?.endTime ?? "10:00";
    const nextEnd = last ? `${String(Math.min(23, Number(nextStart.slice(0, 2)) + 2)).padStart(2, "0")}:${nextStart.slice(3, 5)}` : "18:00";
    setWindows((current) => [...current, { dayOfWeek: day, startTime: nextStart, endTime: nextEnd }]);
  }

  function patch(index: number, key: "startTime" | "endTime", value: string) {
    setWindows((current) => current.map((window, currentIndex) => currentIndex === index ? { ...window, [key]: value } : window));
  }

  function remove(index: number) {
    setWindows((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  function toggleCopyTarget(day: number) {
    if (day === copySourceDay) return;
    setCopyTargets((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day]);
  }

  function copyDay() {
    const source = windows.filter((window) => window.dayOfWeek === copySourceDay);
    setWindows((current) => [
      ...current.filter((window) => !copyTargets.includes(window.dayOfWeek)),
      ...copyTargets.flatMap((day) => source.map((window) => ({ ...window, dayOfWeek: day }))),
    ]);
    setMessage(`${dayNames[copySourceDay]} скопійовано у вибрані дні`);
  }

  async function saveTemplate(targetSeason = season, targetWindows = windows) {
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/teachers/${teacherId}/availability`, {
        method: "PUT",
        body: JSON.stringify({ season: targetSeason, windows: targetWindows }),
      });
      setMessage(targetSeason === season ? "Вільні години збережено" : "Шаблон скопійовано в інший сезон");
      await load();
    } catch (exception: any) {
      setError(exception?.message ?? "Не вдалося зберегти вільні години");
    } finally {
      setBusy(false);
    }
  }

  async function copyToOtherSeason() {
    const targetSeason: Season = season === "SCHOOL_YEAR" ? "SUMMER" : "SCHOOL_YEAR";
    await saveTemplate(targetSeason, windows);
  }

  function editException(exception: any) {
    setExceptionDate(exception.date);
    setExceptionAllDay(Boolean(exception.isUnavailableAllDay));
    setExceptionWindows((exception.windows ?? []).length
      ? exception.windows.map((window: any) => ({ startTime: shortTime(window.startTime), endTime: shortTime(window.endTime) }))
      : [{ startTime: "10:00", endTime: "18:00" }]);
  }

  async function saveException() {
    if (!exceptionDate) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/teachers/${teacherId}/availability/exception`, {
        method: "PUT",
        body: JSON.stringify({
          date: exceptionDate,
          isUnavailableAllDay: exceptionAllDay,
          windows: exceptionAllDay ? [] : exceptionWindows,
        }),
      });
      setMessage("Виняток календаря збережено");
      setExceptionDate("");
      setExceptionAllDay(true);
      setExceptionWindows([{ startTime: "10:00", endTime: "18:00" }]);
      await load();
    } catch (exception: any) {
      setError(exception?.message ?? "Не вдалося зберегти виняток");
    } finally {
      setBusy(false);
    }
  }

  async function deleteException(date: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/teachers/${teacherId}/availability/exceptions/${date}`, { method: "DELETE" });
      setMessage("Виняток видалено");
      await load();
    } catch (exception: any) {
      setError(exception?.message ?? "Не вдалося видалити виняток");
    } finally {
      setBusy(false);
    }
  }

  return <div className={`stack availability-editor ${compact ? "compact-availability-editor" : ""}`}>
    <div className="section-heading row">
      <div>
        <h2>{title}</h2>
        <p className="muted">Шкільний рік і літо мають окремі тижневі шаблони. Разові зміни додаються нижче як винятки.</p>
      </div>
      <div className="row">
        <button className={`btn ${season === "SCHOOL_YEAR" ? "" : "secondary"}`} type="button" onClick={() => setSeason("SCHOOL_YEAR")}>01.09–31.05</button>
        <button className={`btn ${season === "SUMMER" ? "" : "secondary"}`} type="button" onClick={() => setSeason("SUMMER")}>01.06–31.08</button>
      </div>
    </div>

    {error && <div className="error">{error}</div>}
    {message && <div className="success">{message}</div>}

    <div className="card availability-overview-card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div><strong>Огляд тижня</strong><div className="muted form-note">Шкала 06:00–24:00</div></div>
        <button className="btn secondary" type="button" disabled={busy} onClick={copyToOtherSeason}>Скопіювати в {season === "SCHOOL_YEAR" ? "літо" : "навчальний рік"}</button>
      </div>
      <div className="availability-overview">
        {Array.from({ length: 7 }, (_, index) => index + 1).map((day) => <div className="availability-overview-row" key={day}>
          <strong>{shortDayNames[day]}</strong>
          <div className="availability-track">
            {(grouped[day] ?? []).map(({ window, originalIndex }: any) => <span
              key={`${day}-${originalIndex}`}
              className="availability-bar"
              style={intervalStyle(window.startTime, window.endTime)}
              title={`${window.startTime}–${window.endTime}`}
            />)}
          </div>
          <span className="muted availability-overview-label">{(grouped[day] ?? []).map(({ window }: any) => `${window.startTime}–${window.endTime}`).join(", ") || "—"}</span>
        </div>)}
      </div>
    </div>

    <div className="card stack availability-copy-card">
      <div><strong>Швидке копіювання дня</strong><div className="muted form-note">Наприклад, налаштуйте понеділок і скопіюйте його на середу та пʼятницю.</div></div>
      <div className="availability-copy-controls">
        <select className="select" value={copySourceDay} onChange={(event) => { const day = Number(event.target.value); setCopySourceDay(day); setCopyTargets((current) => current.filter((item) => item !== day)); }}>
          {Array.from({ length: 7 }, (_, index) => index + 1).map((day) => <option key={day} value={day}>{dayNames[day]}</option>)}
        </select>
        <div className="row availability-copy-targets">
          {Array.from({ length: 7 }, (_, index) => index + 1).filter((day) => day !== copySourceDay).map((day) => <label className={`choice-card compact-choice ${copyTargets.includes(day) ? "selected" : ""}`} key={day}>
            <input type="checkbox" checked={copyTargets.includes(day)} onChange={() => toggleCopyTarget(day)} /> {shortDayNames[day]}
          </label>)}
        </div>
        <button className="btn secondary" type="button" disabled={!copyTargets.length} onClick={copyDay}>Скопіювати</button>
      </div>
    </div>

    <div className="availability-days-grid">
      {Array.from({ length: 7 }, (_, index) => index + 1).map((day) => <section className="card availability-day-card" key={day}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>{dayNames[day]}</h2>
          <button className="btn secondary" type="button" onClick={() => add(day)}>+ Інтервал</button>
        </div>
        <div className="stack">
          {(grouped[day] ?? []).map(({ window, originalIndex }: any) => <div className="availability-row" key={`${day}-${originalIndex}`}>
            <input className="input" type="time" step="1800" value={window.startTime} onChange={(event) => patch(originalIndex, "startTime", event.target.value)} />
            <span>—</span>
            <input className="input" type="time" step="1800" value={window.endTime} onChange={(event) => patch(originalIndex, "endTime", event.target.value)} />
            <button className="btn secondary" type="button" onClick={() => remove(originalIndex)}>×</button>
          </div>)}
          {!(grouped[day] ?? []).length && <div className="muted">Не працюю</div>}
        </div>
      </section>)}
    </div>

    <div className="row" style={{ justifyContent: "flex-end" }}>
      <button className="btn" type="button" disabled={busy} onClick={() => saveTemplate()}>{busy ? "Зберігаємо…" : "Зберегти шаблон"}</button>
    </div>

    <div className="grid cols-2 availability-exception-layout">
      <section className="card stack">
        <div><h2>Разовий виняток</h2><p className="muted">Вихідний день або інші години лише на конкретну дату.</p></div>
        <div className="field"><label>Дата</label><input className="input" type="date" value={exceptionDate} onChange={(event) => setExceptionDate(event.target.value)} /></div>
        <label className={`choice-card ${exceptionAllDay ? "selected" : ""}`}>
          <input type="checkbox" checked={exceptionAllDay} onChange={(event) => setExceptionAllDay(event.target.checked)} /> Не працюю весь день
        </label>
        {!exceptionAllDay && <div className="stack">
          {exceptionWindows.map((window, index) => <div className="availability-row" key={index}>
            <input className="input" type="time" step="1800" value={window.startTime} onChange={(event) => setExceptionWindows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, startTime: event.target.value } : item))} />
            <span>—</span>
            <input className="input" type="time" step="1800" value={window.endTime} onChange={(event) => setExceptionWindows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, endTime: event.target.value } : item))} />
            <button className="btn secondary" type="button" onClick={() => setExceptionWindows((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button>
          </div>)}
          <button className="btn secondary" type="button" onClick={() => setExceptionWindows((current) => [...current, { startTime: "10:00", endTime: "18:00" }])}>+ Інтервал</button>
        </div>}
        <button className="btn" type="button" disabled={!exceptionDate || busy || (!exceptionAllDay && !exceptionWindows.length)} onClick={saveException}>Зберегти виняток</button>
      </section>

      <section className="card stack">
        <div><h2>Майбутні винятки</h2><p className="muted">Відпустки керуються окремо й тут не дублюються.</p></div>
        {(data?.exceptions ?? []).map((exception: any) => <div className="availability-exception-item" key={exception.id}>
          <div>
            <strong>{exception.date}</strong>
            <div className="muted form-note">{exception.isUnavailableAllDay ? "Не працює весь день" : (exception.windows ?? []).map((window: any) => `${shortTime(window.startTime)}–${shortTime(window.endTime)}`).join(", ")}</div>
          </div>
          <div className="row">
            <button className="btn secondary" type="button" onClick={() => editException(exception)}>Змінити</button>
            <button className="btn secondary" type="button" disabled={busy} onClick={() => deleteException(exception.date)}>Видалити</button>
          </div>
        </div>)}
        {!data?.exceptions?.length && <div className="muted">Майбутніх винятків немає.</div>}
      </section>
    </div>
  </div>;
}
