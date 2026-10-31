"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, roleHome, type Me } from "../lib/api";

type NavItem = { href: string; label: string };

const navByRole: Record<string, NavItem[]> = {
  ADMIN: [
    { href: "/admin", label: "Огляд" },
    { href: "/admin/schedule", label: "Розклад" },
    { href: "/admin/applications", label: "Заявки" },
    { href: "/admin/teacher-applications", label: "Анкети викладачів" },
    { href: "/admin/teacher-reviews", label: "Відгуки викладачів" },
    { href: "/admin/families", label: "Сімʼї" },
    { href: "/admin/students", label: "Учні" },
    { href: "/admin/teachers", label: "Викладачі" },
    { href: "/admin/vacations", label: "Відпустки" },
    { href: "/admin/subjects", label: "Предмети й тарифи" },
    { href: "/admin/finance", label: "Фінанси" },
    { href: "/admin/team", label: "Команда" },
    { href: "/admin/courses", label: "Курси" },
    { href: "/admin/settings", label: "Налаштування" },
    { href: "/admin/audit", label: "Журнал аудиту" },
  ],
  SUPPORT_MANAGER: [
    { href: "/admin", label: "Огляд" },
    { href: "/admin/schedule", label: "Розклад" },
    { href: "/admin/applications", label: "Заявки" },
    { href: "/admin/teacher-applications", label: "Анкети викладачів" },
    { href: "/admin/families", label: "Сімʼї" },
    { href: "/admin/students", label: "Учні" },
    { href: "/admin/teachers", label: "Викладачі" },
    { href: "/admin/vacations", label: "Відпустки" },
  ],
  MANAGER: [
    { href: "/manager", label: "Головна" },
    { href: "/manager/applications", label: "Заявки" },
    { href: "/manager/families", label: "Сімʼї" },
    { href: "/manager/students", label: "Учні" },
    { href: "/manager/teachers", label: "Викладачі" },
    { href: "/manager/vacations", label: "Відпустки" },
    { href: "/manager/schedule", label: "Розклад" },
    { href: "/manager/first-lessons", label: "Перші уроки" },
    { href: "/manager/payments", label: "Оплати" },
  ],
  TEACHER: [
    { href: "/teacher", label: "Головна" },
    { href: "/teacher/schedule", label: "Календар" },
    { href: "/teacher/students", label: "Учні" },
    { href: "/teacher/knowledge", label: "База знань" },
    { href: "/teacher/reviews", label: "Відгуки" },
    { href: "/teacher/availability", label: "Вільні години" },
    { href: "/teacher/payouts", label: "Виплати" },
    { href: "/teacher/vacations", label: "Відпустки" },
  ],
  PARENT: [
    { href: "/parent", label: "Головна" },
    { href: "/parent/schedule", label: "Розклад" },
    { href: "/parent/reschedules", label: "Перенесення" },
    { href: "/parent/learning", label: "Навчання" },
    { href: "/parent/reviews", label: "Відгуки" },
    { href: "/parent/payments", label: "Оплати" },
    { href: "/parent/courses", label: "Курси" },
  ],
  STUDENT: [
    { href: "/student", label: "Головна" },
    { href: "/student/schedule", label: "Розклад" },
    { href: "/student/journal", label: "Журнал" },
    { href: "/student/courses", label: "Курси" },
  ],
  FINANCIER: [
    { href: "/financier", label: "Виплати" },
    { href: "/financier/teachers", label: "Викладачі" },
  ],
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

function isActive(path: string, href: string) {
  if (path === href) return true;
  if (["/admin", "/manager", "/teacher", "/parent", "/student", "/financier"].includes(href)) return false;
  return path.startsWith(`${href}/`);
}

function navGlyph(item: NavItem) {
  const key = `${item.href} ${item.label}`.toLowerCase();
  if (key.includes("schedule") || key.includes("розклад") || key.includes("урок")) return "calendar";
  if (key.includes("student") || key.includes("учні") || key.includes("family") || key.includes("сім")) return "users";
  if (key.includes("teacher") || key.includes("виклада")) return "graduate";
  if (key.includes("payment") || key.includes("finance") || key.includes("виплат") || key.includes("оплат")) return "card";
  if (key.includes("course") || key.includes("курс") || key.includes("journal") || key.includes("журнал") || key.includes("навчання")) return "book";
  if (key.includes("application") || key.includes("заяв")) return "inbox";
  if (key.includes("vacation") || key.includes("відпуст")) return "sun";
  if (key.includes("setting") || key.includes("налашт")) return "settings";
  if (key.includes("audit") || key.includes("аудит")) return "shield";
  if (key.includes("team") || key.includes("команда")) return "team";
  return "home";
}

function Glyph({ name }: { name: string }) {
  const common = { width: 19, height: 19, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "calendar") return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>;
  if (name === "users" || name === "team") return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M17 11a4 4 0 0 1 4 4v2M16 3.2a4 4 0 0 1 0 7.6"/></svg>;
  if (name === "graduate") return <svg {...common}><path d="m2 10 10-5 10 5-10 5L2 10Z"/><path d="M6 12.5V17c3 2 9 2 12 0v-4.5M22 10v6"/></svg>;
  if (name === "card") return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/></svg>;
  if (name === "book") return <svg {...common}><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v18H7.5A3.5 3.5 0 0 0 4 23V5.5ZM20 5.5A3.5 3.5 0 0 0 16.5 2H13v18h3.5A3.5 3.5 0 0 1 20 23V5.5Z"/></svg>;
  if (name === "inbox") return <svg {...common}><path d="M4 4h16l2 12H16l-2 3h-4l-2-3H2L4 4Z"/><path d="M7 9h10"/></svg>;
  if (name === "sun") return <svg {...common}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>;
  if (name === "settings") return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.8 1.8 0 0 0 .4 2l.1.1-2.8 2.8-.1-.1a1.8 1.8 0 0 0-2-.4 1.8 1.8 0 0 0-1 1.7V21h-4v-.1a1.8 1.8 0 0 0-1-1.7 1.8 1.8 0 0 0-2 .4l-.1.1-2.8-2.8.1-.1a1.8 1.8 0 0 0 .4-2 1.8 1.8 0 0 0-1.7-1H3v-4h.1a1.8 1.8 0 0 0 1.7-1 1.8 1.8 0 0 0-.4-2l-.1-.1 2.8-2.8.1.1a1.8 1.8 0 0 0 2 .4 1.8 1.8 0 0 0 1-1.7V3h4v.1a1.8 1.8 0 0 0 1 1.7 1.8 1.8 0 0 0 2-.4l.1-.1 2.8 2.8-.1.1a1.8 1.8 0 0 0-.4 2 1.8 1.8 0 0 0 1.7 1h.1v4h-.1a1.8 1.8 0 0 0-1.7 1Z"/></svg>;
  if (name === "shield") return <svg {...common}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>;
  return <svg {...common}><path d="m3 10 9-7 9 7"/><path d="M5 9v12h14V9M9 21v-7h6v7"/></svg>;
}

export function PlatformShell({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: string[] }) {
  const router = useRouter();
  const path = usePathname();
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ user: Me }>("/auth/me")
      .then(({ user }) => {
        if (allowedRoles?.length && !allowedRoles.some((role) => user.roles.includes(role))) {
          router.replace(roleHome(user.roles));
          return;
        }
        setUser(user);
      })
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router, allowedRoles?.join("|")]);

  const primaryRole = useMemo(() => {
    if (!user) return "";
    return ["ADMIN", "SUPPORT_MANAGER", "MANAGER", "FINANCIER", "TEACHER", "PARENT", "STUDENT"].find((role) => user.roles.includes(role)) ?? user.roles[0] ?? "";
  }, [user]);
  const nav = navByRole[primaryRole] ?? [];

  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => null);
    router.replace("/login");
  }

  if (loading || !user) return <div className="login"><div className="login-card">Завантаження кабінету…</div></div>;

  const avatar = user.email.slice(0, 1).toUpperCase();

  return <div className="shell glass-shell">
    <aside className="sidebar glass-sidebar">
      <Link href={roleHome(user.roles)} className="brand glass-brand">
        <span className="brand-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 7.5c4.2 0 7.8 1.2 11 3.7 3.2-2.5 6.8-3.7 11-3.7v17c-4.3 0-7.9 1.1-11 3.4-3.1-2.3-6.7-3.4-11-3.4v-17Z"/><path d="M16 11.2v16.4"/></svg></span>
        <span><strong>School Platform</strong><small>Освіта · Люди · Розвиток</small></span>
      </Link>

      <nav className="nav glass-nav">
        {nav.map((item) => {
          const active = isActive(path, item.href);
          return <Link key={item.href} className={active ? "active" : ""} href={item.href} aria-current={active ? "page" : undefined}>
            <span className="nav-icon"><Glyph name={navGlyph(item)} /></span>
            <span>{item.label}</span>
          </Link>;
        })}
      </nav>

      <div className="sidebar-spacer" />
      <div className="sidebar-note">
        <span className="sidebar-note-mark">✦</span>
        <strong>Разом створюємо більше можливостей</strong>
        <small>Сучасна освіта для сильного майбутнього.</small>
      </div>
    </aside>

    <section className="content">
      <header className="topbar glass-topbar">
        <div className="topbar-context">
          <span className="topbar-eyebrow">School Platform</span>
          <strong>{roleLabel[primaryRole] ?? primaryRole}</strong>
        </div>
        <div className="row topbar-actions">
          <Link href="/profile" className="profile-chip" aria-label="Відкрити профіль">
            <span className="profile-avatar">{avatar}</span>
            <span className="profile-copy"><strong>Профіль</strong><small>{user.email}</small></span>
          </Link>
          <button className="icon-button" onClick={logout} title="Вийти" aria-label="Вийти">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3"/><path d="M13 3h5a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-5"/></svg>
          </button>
        </div>
      </header>
      <main className="main">{children}</main>
    </section>

    <nav className="mobile-nav" aria-label="Навігація кабінету">
      {nav.map((item) => {
        const active = isActive(path, item.href);
        return <Link key={item.href} className={active ? "active" : ""} href={item.href} aria-current={active ? "page" : undefined}>
          <span className="mobile-nav-icon"><Glyph name={navGlyph(item)} /></span>
          <span>{item.label}</span>
        </Link>;
      })}
      <Link className={path === "/profile" ? "active" : ""} href="/profile" aria-current={path === "/profile" ? "page" : undefined}>
        <span className="mobile-nav-icon"><Glyph name="users" /></span>
        <span>Профіль</span>
      </Link>
    </nav>
  </div>;
}
