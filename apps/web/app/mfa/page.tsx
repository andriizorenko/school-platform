"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, roleHome, type Me } from "../../lib/api";

type MfaSetup = {
  secret: string;
  otpauthUri: string;
};

function MfaFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setupRequested = searchParams.get("setup") === "1";
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState<string[]>([]);
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const result = await api<{ user: Me; mfaVerified: boolean }>("/auth/me");
        if (!active) return;
        setMe(result.user);

        if (result.mfaVerified) {
          router.replace(roleHome(result.user.roles));
          return;
        }

        if (setupRequested) {
          try {
            const setupResult = await api<MfaSetup>("/auth/mfa/setup", { method: "POST" });
            if (active) setSetup(setupResult);
          } catch (caught: unknown) {
            if (active) setError(caught instanceof Error ? caught.message : "Не вдалося налаштувати 2FA");
          }
        }
      } catch {
        if (active) router.replace("/login");
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [router, setupRequested]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");

    try {
      if (setup) {
        const result = await api<{ recoveryCodes: string[] }>("/auth/mfa/enable", {
          method: "POST",
          body: JSON.stringify({ code }),
        });
        setRecovery(result.recoveryCodes);
        if (!result.recoveryCodes?.length && me) router.replace(roleHome(me.roles));
        return;
      }

      await api("/auth/mfa/verify", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      if (me) router.replace(roleHome(me.roles));
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "Невірний код");
    }
  }

  if (recovery.length) {
    return (
      <main className="login">
        <div className="login-card stack">
          <h1>Збережіть recovery-коди</h1>
          <p className="muted">
            Кожен код одноразовий. Збережіть їх у надійному місці — вони потрібні, якщо втратите доступ до authenticator.
          </p>
          <div className="recovery-grid">
            {recovery.map((item) => <code key={item}>{item}</code>)}
          </div>
          <button className="btn" onClick={() => me && router.replace(roleHome(me.roles))}>
            Я зберіг коди
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="login">
      <form className="login-card stack" onSubmit={submit}>
        <div>
          <h1>{setup ? "Налаштування 2FA" : "Двофакторна перевірка"}</h1>
          <p className="muted">
            {setup
              ? "Додайте секрет у Google Authenticator, Microsoft Authenticator або інший TOTP-додаток і введіть 6-значний код."
              : "Введіть код з authenticator або один recovery-код."}
          </p>
        </div>
        {setup && (
          <>
            <div className="card compact-card">
              <div className="muted">Секрет</div>
              <code className="secret-code">{setup.secret}</code>
            </div>
            <a className="btn secondary" href={setup.otpauthUri}>Відкрити в authenticator</a>
          </>
        )}
        {error && <div className="error">{error}</div>}
        <div className="field">
          <label>Код</label>
          <input
            autoFocus
            className="input"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="123456"
            required
          />
        </div>
        <button className="btn">Підтвердити</button>
      </form>
    </main>
  );
}

function MfaFallback() {
  return (
    <main className="login">
      <div className="login-card stack">
        <h1>Завантаження…</h1>
      </div>
    </main>
  );
}

export default function MfaPage() {
  return (
    <Suspense fallback={<MfaFallback />}>
      <MfaFlow />
    </Suspense>
  );
}
