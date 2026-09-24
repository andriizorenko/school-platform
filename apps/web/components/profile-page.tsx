"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Me } from "../lib/api";
import { dateTime } from "../lib/format";
import { PlatformShell } from "./platform-shell";
import { TeacherSelfProfileCard } from "./teacher-self-profile-card";

type Preference = {
  eventType: string;
  description?: string | null;
  userConfigurable: boolean;
  channels: { TELEGRAM: boolean; EMAIL: boolean };
};

type TelegramStatus = {
  status: "ACTIVE" | "DISCONNECTED";
  username?: string | null;
  connectedAt?: string | null;
  disconnectedAt?: string | null;
};

type NotificationItem = {
  id: string;
  eventType: string;
  description?: string | null;
  status: "PENDING" | "PROCESSING" | "SENT" | "FAILED" | "CANCELLED";
  payload: {
    title?: string;
    body?: string;
    actionPath?: string;
    [key: string]: unknown;
  };
  sentAt?: string | null;
  readAt?: string | null;
  createdAt: string;
};

const roleLabel: Record<string, string> = {
  ADMIN: "Адміністратор",
  SUPPORT_MANAGER: "Менеджер підтримки",
  MANAGER: "Менеджер",
  FINANCIER: "Фінансист",
  TEACHER: "Викладач",
  PARENT: "Батьки",
  STUDENT: "Учень",
};

const eventCopy: Record<string, { title: string; help: string }> = {
  LESSON_REMINDER: { title: "Нагадування про заняття", help: "За 1 годину до початку уроку." },
  LESSON_RESCHEDULED: { title: "Перенесення заняття", help: "Коли час конкретного уроку змінено." },
  REGULAR_SCHEDULE_CHANGED: { title: "Зміна регулярного графіка", help: "Коли змінюється постійний розклад." },
  FIRST_LESSON_ASSIGNED: { title: "Нове перше заняття", help: "Нове перше заняття з короткою інформацією про учня." },
  REGULAR_STUDENT_ASSIGNED: { title: "Новий регулярний учень", help: "ПІБ учня, предмет і регулярний графік." },
  PRIMARY_TEACHER_CHANGED: { title: "Зміна основного викладача", help: "Коли учня переводять до іншого основного викладача." },
  LOW_BALANCE: { title: "Залишилось 3 заняття", help: "Попередження про низький баланс." },
  ZERO_BALANCE: { title: "Баланс занять = 0", help: "Одне повідомлення після вичерпання балансу." },
  REPORT_REQUESTED: { title: "Запит на звіт", help: "Батьки запросили звіт про успішність." },
  REPORT_READY: { title: "Звіт готовий", help: "Коли звіт про успішність опубліковано." },
  COURSE_ACCESS_GRANTED: { title: "Доступ до курсу", help: "Коли дитині надано доступ до нового курсу." },
  UNMARKED_LESSON_REMINDER: { title: "Невідмічений урок", help: "Нагадування викладачу наступного дня." },
  TEACHER_VACATION_APPROVED: { title: "Відпустку погоджено", help: "Результат запиту на відпустку." },
  TEACHER_VACATION_REJECTED: { title: "Відпустку відхилено", help: "Результат запиту на відпустку." },
  SUBSTITUTE_ASSIGNED: { title: "Призначено заміну", help: "Коли конкретне заняття проведе інший викладач." },
  SECURITY_ACCOUNT_CHANGED: { title: "Безпека акаунта", help: "Критичні зміни входу та безпеки. Це повідомлення не вимикається." },
};

function copyFor(eventType: string, fallback?: string | null) {
  return eventCopy[eventType] ?? { title: fallback ?? eventType, help: fallback ?? "Системне сповіщення." };
}

function notificationStatus(status: NotificationItem["status"]) {
  if (status === "SENT") return "Надіслано";
  if (status === "FAILED") return "Помилка доставки";
  if (status === "PROCESSING") return "Надсилається";
  return "Заплановано";
}

export function ProfilePage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [prefs, setPrefs] = useState<Preference[]>([]);
  const [telegram, setTelegram] = useState<TelegramStatus | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [mfa, setMfa] = useState<any>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busyEvent, setBusyEvent] = useState<string | null>(null);
  const [linkingUntil, setLinkingUntil] = useState<number | null>(null);

  async function load() {
    try {
      const [{ user }, p, t, history, s, m] = await Promise.all([
        api<{ user: Me }>("/auth/me"),
        api<Preference[]>("/notifications/preferences").catch(() => []),
        api<TelegramStatus>("/notifications/telegram").catch(() => null),
        api<NotificationItem[]>("/notifications?limit=12").catch(() => []),
        api<any[]>("/auth/sessions"),
        api<any>("/auth/mfa/status").catch(() => null),
      ]);
      setMe(user);
      setPrefs(p);
      setTelegram(t);
      setNotifications(history);
      setSessions(s);
      setMfa(m);
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!linkingUntil) return;
    const timer = window.setInterval(async () => {
      if (Date.now() >= linkingUntil) {
        setLinkingUntil(null);
        return;
      }
      const status = await api<TelegramStatus>("/notifications/telegram").catch(() => null);
      if (status?.status === "ACTIVE") {
        setTelegram(status);
        setLinkingUntil(null);
        setMessage("Telegram успішно підключено.");
        const updatedPrefs = await api<Preference[]>("/notifications/preferences").catch(() => prefs);
        setPrefs(updatedPrefs);
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [linkingUntil]);

  const privileged = useMemo(
    () => me?.roles.some((role) => ["ADMIN", "FINANCIER", "SUPPORT_MANAGER"].includes(role)),
    [me],
  );
  const unreadCount = notifications.filter((item) => !item.readAt).length;

  async function toggle(pref: Preference) {
    if (!pref.userConfigurable) return;
    setBusyEvent(pref.eventType);
    setError("");
    try {
      await api("/notifications/preferences", {
        method: "PATCH",
        body: JSON.stringify({
          eventType: pref.eventType,
          channel: "TELEGRAM",
          enabled: !pref.channels.TELEGRAM,
        }),
      });
      setPrefs((current) =>
        current.map((item) =>
          item.eventType === pref.eventType
            ? { ...item, channels: { ...item.channels, TELEGRAM: !item.channels.TELEGRAM } }
            : item,
        ),
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyEvent(null);
    }
  }

  async function linkTelegram() {
    setError("");
    setMessage("");
    try {
      const result = await api<{ deepLink?: string | null; expiresAt: string }>("/notifications/telegram/link", { method: "POST" });
      if (!result.deepLink) {
        setError("Telegram-бот ще не налаштований у цьому середовищі.");
        return;
      }
      window.open(result.deepLink, "_blank", "noopener,noreferrer");
      setLinkingUntil(new Date(result.expiresAt).getTime());
      setMessage("У Telegram натисніть Start. Після підтвердження статус тут оновиться автоматично.");
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function disconnectTelegram() {
    setError("");
    try {
      await api("/notifications/telegram/disconnect", { method: "POST" });
      setTelegram({ status: "DISCONNECTED" });
      setLinkingUntil(null);
      setMessage("Telegram відключено. Історія сповіщень у платформі збережена.");
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function revoke(id: string) {
    await api(`/auth/sessions/${id}`, { method: "DELETE" });
    void load();
  }

  async function openNotification(item: NotificationItem) {
    if (!item.readAt) {
      await api(`/notifications/${item.id}/read`, { method: "PATCH" }).catch(() => null);
      setNotifications((current) => current.map((row) => (row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row)));
    }
    if (typeof item.payload.actionPath === "string" && item.payload.actionPath.startsWith("/")) {
      router.push(item.payload.actionPath);
    }
  }

  async function markAllRead() {
    await api("/notifications/read-all", { method: "POST" });
    const now = new Date().toISOString();
    setNotifications((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? now })));
  }

  return (
    <PlatformShell>
      <div className="page-head">
        <div>
          <h1>Профіль і безпека</h1>
          <p className="muted">Акаунт, Telegram, сповіщення та активні пристрої.</p>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}

      <div className="grid cols-2 profile-top-grid">
        <section className="card stack">
          <h2>Акаунт</h2>
          <div>
            <strong>{me?.email ?? "…"}</strong>
            <div className="muted">{me?.roles.map((role) => roleLabel[role] ?? role).join(" · ")}</div>
          </div>
          {privileged && (
            <div className="row">
              <span className={`badge ${mfa?.enabled ? "paid" : "booked"}`}>
                {mfa?.enabled ? "2FA увімкнено" : "Потрібно налаштувати 2FA"}
              </span>
              {!mfa?.enabled && <a className="btn secondary" href="/mfa?setup=1">Налаштувати</a>}
            </div>
          )}
        </section>

        <section className="card stack telegram-card">
          <div className="row telegram-heading">
            <h2>Telegram</h2>
            <span className={`badge ${telegram?.status === "ACTIVE" ? "paid" : "booked"}`}>
              {telegram?.status === "ACTIVE" ? "Підключено" : "Не підключено"}
            </span>
          </div>
          {telegram?.status === "ACTIVE" ? (
            <>
              <div>
                <strong>{telegram.username ? `@${telegram.username}` : "Telegram-акаунт підключено"}</strong>
                {telegram.connectedAt && <div className="muted">Підключено: {dateTime(telegram.connectedAt)}</div>}
              </div>
              <p className="muted form-note">Вимкнені нижче типи повідомлень бот не надсилатиме. Критичні security-події залишаються обовʼязковими.</p>
              <button className="btn secondary" onClick={disconnectTelegram}>Відключити Telegram</button>
            </>
          ) : (
            <>
              <p className="muted">Підключіть бота, щоб отримувати вибрані нагадування від школи.</p>
              <button className="btn" onClick={linkTelegram} disabled={Boolean(linkingUntil)}>
                {linkingUntil ? "Очікуємо підтвердження…" : "Підключити Telegram"}
              </button>
            </>
          )}
        </section>
      </div>

      {me?.roles.includes("TEACHER") && <TeacherSelfProfileCard />}

      <section className="card notification-settings-card" style={{ marginTop: 16 }}>
        <div className="row section-heading">
          <div>
            <h2>Telegram-сповіщення</h2>
            <p className="muted">Показані тільки повідомлення, які стосуються вашої ролі.</p>
          </div>
          {telegram?.status !== "ACTIVE" && <span className="badge booked">Потрібен Telegram</span>}
        </div>
        <div className="notification-settings-list">
          {prefs.map((pref) => {
            const copy = copyFor(pref.eventType, pref.description);
            return (
              <div className="notification-setting-row" key={pref.eventType}>
                <div>
                  <strong>{copy.title}</strong>
                  <div className="muted form-note">{copy.help}</div>
                </div>
                <div className="row notification-setting-control">
                  {!pref.userConfigurable && <span className="badge first">Обовʼязкове</span>}
                  <label className={`switch ${!pref.userConfigurable || telegram?.status !== "ACTIVE" ? "disabled" : ""}`} aria-label={copy.title}>
                    <input
                      type="checkbox"
                      checked={pref.channels.TELEGRAM}
                      disabled={!pref.userConfigurable || telegram?.status !== "ACTIVE" || busyEvent === pref.eventType}
                      onChange={() => void toggle(pref)}
                    />
                    <span />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
        {!prefs.length && <div className="empty compact-empty">Для цієї ролі немає користувацьких Telegram-сповіщень.</div>}
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="row section-heading">
          <div>
            <h2>Останні сповіщення</h2>
            <p className="muted">Історія зберігається в кабінеті незалежно від Telegram.</p>
          </div>
          {unreadCount > 0 && <button className="btn secondary" onClick={markAllRead}>Прочитати всі · {unreadCount}</button>}
        </div>
        <div className="notification-history">
          {notifications.map((item) => {
            const copy = copyFor(item.eventType, item.description);
            const title = typeof item.payload.title === "string" ? item.payload.title : copy.title;
            const body = typeof item.payload.body === "string" ? item.payload.body : copy.help;
            return (
              <button
                type="button"
                className={`notification-history-row ${!item.readAt ? "unread" : ""}`}
                key={item.id}
                onClick={() => void openNotification(item)}
              >
                <span className="notification-history-dot" />
                <span className="notification-history-copy">
                  <strong>{title}</strong>
                  <span>{body}</span>
                  <small className="muted">{dateTime(item.sentAt ?? item.createdAt)} · {notificationStatus(item.status)}</small>
                </span>
                {item.payload.actionPath && <span className="notification-history-action">Відкрити →</span>}
              </button>
            );
          })}
          {!notifications.length && <div className="empty compact-empty">Сповіщень поки немає.</div>}
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <h2>Активні пристрої</h2>
        <div className="stack">
          {sessions.map((session) => (
            <div className="session-row" key={session.id}>
              <div>
                <strong>{session.current ? "Поточна сесія" : "Активна сесія"}</strong>
                <div className="muted">{session.userAgent || "Невідомий пристрій"}</div>
                <small className="muted">Остання активність: {dateTime(session.lastUsedAt)}</small>
              </div>
              {!session.current && <button className="btn secondary" onClick={() => revoke(session.id)}>Завершити</button>}
            </div>
          ))}
        </div>
      </section>
    </PlatformShell>
  );
}
