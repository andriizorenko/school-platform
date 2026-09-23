"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "../lib/api";

export function TeacherSelfProfileCard() {
  const [profile, setProfile] = useState<any>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [zoomUrl, setZoomUrl] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const result = await api<any>("/teachers/me/profile");
      setProfile(result);
      setFirstName(result.firstName ?? "");
      setLastName(result.lastName ?? "");
      setPhone(result.phone ?? "");
      setZoomUrl(result.zoomUrl ?? "");
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api("/teachers/me/profile", {
        method: "PATCH",
        body: JSON.stringify({ firstName, lastName, phone, zoomUrl: zoomUrl || undefined }),
      });
      setMessage("Профіль викладача оновлено.");
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <section className="card stack" style={{ marginTop: 16 }}>
      <div>
        <h2>Дані викладача</h2>
        <p className="muted">Ви можете самостійно змінити контактні дані та постійне Zoom-посилання. Предмети й ставки змінює адміністрація.</p>
      </div>
      {message && <div className="success">{message}</div>}
      {error && <div className="error">{error}</div>}
      {profile && (
        <form className="stack" onSubmit={submit}>
          <div className="grid cols-2">
            <div className="field"><label>Імʼя</label><input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div>
            <div className="field"><label>Прізвище</label><input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
            <div className="field"><label>Телефон</label><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            <div className="field"><label>Статус</label><input className="input" value={profile.teacherStatus ?? ""} disabled /></div>
          </div>
          <div className="field"><label>Постійне Zoom-посилання</label><input className="input" type="url" value={zoomUrl} onChange={(e) => setZoomUrl(e.target.value)} placeholder="https://zoom.us/..." /></div>
          <button className="btn secondary">Зберегти</button>
        </form>
      )}
    </section>
  );
}
