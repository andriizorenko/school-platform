"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api, roleHome, type Me } from "../../lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setLoading(true);
    try {
      const result = await api<{ user: Me; mfaRequired?: boolean; mfaSetupRequired?: boolean }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      if (result.mfaSetupRequired) router.replace("/mfa?setup=1");
      else if (result.mfaRequired) router.replace("/mfa");
      else router.replace(roleHome(result.user.roles));
    } catch (e: any) { setError(e.message ?? "Не вдалося увійти"); }
    finally { setLoading(false); }
  }

  return <main className="login"><form className="login-card stack" onSubmit={submit}>
    <div><h1>Вхід до школи</h1><p className="muted">Єдина платформа для навчання, розкладу та операцій школи.</p></div>
    {error && <div className="error">{error}</div>}
    <div className="field"><label htmlFor="login-email">Email</label><input id="login-email" className="input" type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required /></div>
    <div className="field"><label htmlFor="login-password">Пароль</label><input id="login-password" className="input" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required /></div>
    <button className="btn" disabled={loading}>{loading ? "Входимо…" : "Увійти"}</button><a className="muted" href="/forgot-password">Забули пароль?</a><a className="muted" href="/">← На головну</a>
  </form></main>;
}
