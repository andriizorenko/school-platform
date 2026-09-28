"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../../lib/api";
import { PasswordInput } from "../../components/password-input";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api("/auth/password/reset", {
        method: "POST",
        body: JSON.stringify({
          token: searchParams.get("token"),
          password,
        }),
      });
      router.replace("/login");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Не вдалося змінити пароль");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login">
      <form className="login-card stack" onSubmit={submit}>
        <div>
          <h1>Новий пароль</h1>
          <p className="muted">Створіть новий пароль для входу до платформи. Мінімум 8 символів.</p>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="field">
          <label htmlFor="reset-password">Новий пароль</label>
          <PasswordInput
            id="reset-password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>

        <button className="btn" disabled={loading}>
          {loading ? "Змінюємо…" : "Змінити пароль"}
        </button>
        <a className="muted" href="/login">← Повернутися до входу</a>
      </form>
    </main>
  );
}

function ResetPasswordFallback() {
  return (
    <main className="login">
      <div className="login-card stack">
        <h1>Завантаження…</h1>
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<ResetPasswordFallback />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
