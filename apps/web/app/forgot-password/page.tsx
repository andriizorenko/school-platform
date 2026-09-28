"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      await api("/auth/password/forgot", {
        method: "POST",
        body: JSON.stringify({ email }),
      }).catch(() => null);
      setMessage("Якщо акаунт існує, ми надіслали інструкцію на email.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login">
      <form className="login-card stack" onSubmit={submit}>
        <div>
          <h1>Відновлення пароля</h1>
          <p className="muted">Вкажіть email акаунта — надішлемо посилання для створення нового пароля.</p>
        </div>

        {message && <div className="success">{message}</div>}

        <div className="field">
          <label htmlFor="forgot-password-email">Email</label>
          <input
            id="forgot-password-email"
            className="input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <button className="btn" disabled={loading}>
          {loading ? "Надсилаємо…" : "Надіслати інструкцію"}
        </button>
        <a className="muted" href="/login">← Повернутися до входу</a>
      </form>
    </main>
  );
}
