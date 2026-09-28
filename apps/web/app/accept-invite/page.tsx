"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../../lib/api";
import { PasswordInput } from "../../components/password-input";

function AcceptInviteForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/auth/invitations/accept", {
        method: "POST",
        body: JSON.stringify({
          token: searchParams.get("token"),
          password,
        }),
      });
      router.replace("/login");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Не вдалося активувати акаунт");
    }
  }

  return (
    <main className="login">
      <form className="login-card stack" onSubmit={submit}>
        <h1>Створіть пароль</h1>
        {error && <div className="error">{error}</div>}
        <PasswordInput
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={8}
          required
          ariaLabel="Пароль"
        />
        <button className="btn">Активувати акаунт</button>
      </form>
    </main>
  );
}

function AcceptInviteFallback() {
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
    <Suspense fallback={<AcceptInviteFallback />}>
      <AcceptInviteForm />
    </Suspense>
  );
}
