"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../../lib/api";

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
        <input
          className="input"
          type="password"
          minLength={8}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
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
