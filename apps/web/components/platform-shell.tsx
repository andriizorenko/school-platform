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
    { href: "/admin/families", label: "Сімʼї" },
    { href: "/admin/students", label: "Учні" },
    { href: "/admin/teachers", label: "Викладачі" },
    { href: "/admin/vacations", label: "Відпустки" },
    { href: "/admin/subjects", label: "Предмети й тарифи" },
    { href: "/admin/finance", label: "Фінанси" },
    { href: "/admin/team", label: "Команда" },
    { href: "/admin/courses", label: "Курси" },
    { href: "/admin/settings", label: "Налаштування" },
    { href: "/admin/audit", label: "Audit log" },
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
    { href: "/teacher", label: "Розклад" },
    { href: "/teacher/students", label: "Учні" },
    { href: "/teacher/availability", label: "Вільні години" },
    { href: "/teacher/payouts", label: "Виплати" },
    { href: "/teacher/vacations", label: "Відпустки" },
  ],
  PARENT: [
    { href: "/parent", label: "Головна" },
    { href: "/parent/schedule", label: "Розклад" },
    { href: "/parent/learning", label: "Навчання" },
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

function isActive(path:string, href:string){
  if(path===href) return true;
  if(["/admin","/manager","/teacher","/parent","/student","/financier"].includes(href)) return false;
  return path.startsWith(`${href}/`);
}

export function PlatformShell({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: string[] }) {
  const router = useRouter();
  const path = usePathname();
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ user: Me }>("/auth/me")
      .then(({ user }) => {
        if (allowedRoles?.length && !allowedRoles.some(role => user.roles.includes(role))) {
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
    return ["ADMIN","SUPPORT_MANAGER","MANAGER","FINANCIER","TEACHER","PARENT","STUDENT"].find(r => user.roles.includes(r)) ?? user.roles[0] ?? "";
  }, [user]);
  const nav = navByRole[primaryRole] ?? [];

  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => null);
    router.replace("/login");
  }

  if (loading || !user) return <div className="login"><div className="login-card">Завантаження кабінету…</div></div>;

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand">School Platform</div>
      <nav className="nav">{nav.map(item => <Link key={item.href} className={isActive(path,item.href) ? "active" : ""} href={item.href}>{item.label}</Link>)}</nav>
    </aside>
    <section className="content">
      <header className="topbar">
        <div><strong>{primaryRole}</strong><span className="muted"> · {user.email}</span></div>
        <div className="row topbar-actions"><Link href="/profile" className="btn secondary">Профіль</Link><button className="btn secondary" onClick={logout}>Вийти</button></div>
      </header>
      <main className="main">{children}</main>
    </section>
    <nav className="mobile-nav" aria-label="Навігація кабінету">
      {nav.map(item=><Link key={item.href} className={isActive(path,item.href)?"active":""} href={item.href}>{item.label}</Link>)}
      <Link className={path==="/profile"?"active":""} href="/profile">Профіль</Link>
    </nav>
  </div>;
}
