"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";

const dayNames = ["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];

type Slot = { dayOfWeek: number; startTime: string; durationMinutes: 30 | 60 };
type Match = {
  teacherId: string;
  firstName: string;
  lastName: string;
  phone: string;
  matchType: "FULL" | "PARTIAL" | "NONE";
  selectable: boolean;
  matchedSlots: number;
  requestedSlots: number;
  conflictCount: number;
  slots: Array<Slot & {
    templateCovered: boolean;
    conflictCount: number;
    conflicts: Array<{ date: string; type: "VACATION" | "EXCEPTION" | "BUSY" }>;
  }>;
};

function conflictLabel(type: string) {
  if (type === "VACATION") return "відпустка";
  if (type === "EXCEPTION") return "виняток";
  return "зайнято";
}

export function TeacherScheduleMatcher({
  subjectId,
  effectiveFrom,
  slots,
  selectedTeacherId,
  onSelect,
}: {
  subjectId: string;
  effectiveFrom: string;
  slots: Slot[];
  selectedTeacherId?: string;
  onSelect: (teacher: Match | null) => void;
}) {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const slotSignature = JSON.stringify(slots);

  useEffect(() => {
    setData(null);
    setError("");
  }, [subjectId, effectiveFrom, slotSignature]);

  async function search() {
    if (!subjectId || !effectiveFrom || !slots.length) return;
    setBusy(true); setError("");
    try {
      const normalizedSlots = slots.map((slot) => ({
        dayOfWeek: Number(slot.dayOfWeek),
        startTime: String(slot.startTime).slice(0, 5),
        durationMinutes: Number(slot.durationMinutes),
      }));
      const result = await api<any>("/teachers/match-schedule", {
        method: "POST",
        body: JSON.stringify({ subjectId, effectiveFrom, slots: normalizedSlots }),
      });
      setData(result);
      const selected = result.results?.find((item: Match) => item.teacherId === selectedTeacherId && item.selectable);
      if (!selected && selectedTeacherId) onSelect(null);
    } catch (exception: any) {
      setError(exception?.message ?? "Не вдалося підібрати викладачів");
    } finally {
      setBusy(false);
    }
  }

  const results = (data?.results ?? []) as Match[];
  const full = results.filter((item) => item.matchType === "FULL");
  const partial = results.filter((item) => item.matchType === "PARTIAL");

  return <div className="stack teacher-matcher">
    <div className="row" style={{ justifyContent: "space-between" }}>
      <div>
        <strong>Підбір викладача під графік</strong>
        <div className="muted form-note">Перевіряємо сезонну доступність і конфлікти найближчих 28 днів.</div>
      </div>
      <button className="btn secondary" type="button" disabled={busy || !subjectId || !effectiveFrom || !slots.length} onClick={search}>
        {busy ? "Шукаємо…" : data ? "Оновити підбір" : "Знайти викладачів"}
      </button>
    </div>
    {error && <div className="error">{error}</div>}

    {data && <>
      <div className="row matcher-summary">
        <span className="badge paid">Повний match: {full.length}</span>
        <span className="badge booked">Частковий: {partial.length}</span>
        <span className="muted form-note">Сезон: {data.season === "SUMMER" ? "літо" : "навчальний рік"}</span>
      </div>

      <div className="teacher-match-list">
        {results.filter((item) => item.matchType !== "NONE").map((teacher) => <div className={`teacher-match-card ${selectedTeacherId === teacher.teacherId ? "selected" : ""}`} key={teacher.teacherId}>
          <div className="teacher-match-head">
            <div>
              <strong>{teacher.lastName} {teacher.firstName}</strong>
              <div className="muted form-note">{teacher.phone}</div>
            </div>
            <div className="row">
              <span className={`badge ${teacher.matchType === "FULL" ? "paid" : "booked"}`}>{teacher.matchType === "FULL" ? "Повний match" : `${teacher.matchedSlots}/${teacher.requestedSlots} слотів`}</span>
              {teacher.conflictCount > 0 && <span className="badge booked">{teacher.conflictCount} конфлікт(и)</span>}
            </div>
          </div>

          <div className="match-slot-grid">
            {teacher.slots.map((slot, index) => <div className={`match-slot ${slot.templateCovered ? "covered" : "missing"}`} key={`${slot.dayOfWeek}-${slot.startTime}-${index}`}>
              <strong>{dayNames[slot.dayOfWeek]} {slot.startTime} · {slot.durationMinutes} хв</strong>
              <span>{slot.templateCovered ? "є у вільних годинах" : "немає у шаблоні"}</span>
              {slot.conflicts.length > 0 && <small>{slot.conflicts.slice(0, 3).map((item) => `${item.date}: ${conflictLabel(item.type)}`).join(" · ")}{slot.conflictCount > 3 ? ` · +${slot.conflictCount - 3}` : ""}</small>}
            </div>)}
          </div>

          <div className="row" style={{ justifyContent: "flex-end" }}>
            {teacher.selectable
              ? <button className="btn" type="button" onClick={() => onSelect(teacher)}>{selectedTeacherId === teacher.teacherId ? "Обрано" : "Обрати викладача"}</button>
              : <span className="muted form-note">Потрібно скоригувати графік або дату старту</span>}
          </div>
        </div>)}
        {!results.some((item) => item.matchType !== "NONE") && <div className="card muted">За цим графіком немає навіть часткового збігу. Спробуйте інші години.</div>}
      </div>
    </>}
  </div>;
}
