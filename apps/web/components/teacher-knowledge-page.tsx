"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PlatformShell } from "./platform-shell";

const articles = [
  {
    id: "start",
    category: "Початок роботи",
    title: "Профіль і доступність",
    summary: "Що перевірити перед першими заняттями.",
    steps: [
      "Перевірте дані профілю й предмети, які викладаєте.",
      "Позначте вільні години, щоб менеджер бачив можливі слоти для нових учнів.",
      "Звіряйте призначені заняття в календарі: там видно час, учня та тип уроку.",
    ],
    href: "/teacher/availability",
    action: "Мої вільні години",
  },
  {
    id: "first-lesson",
    category: "Уроки",
    title: "Перший урок",
    summary: "Підготовка, проведення та підсумок.",
    steps: [
      "Відкрийте заняття в календарі й перевірте картку учня та предмет.",
      "Після проведення позначте фактичний результат уроку в його картці.",
      "Заповніть підсумок першого уроку, якщо система показує, що потрібен звіт. Менеджер використовує його для наступних кроків із сім’єю.",
    ],
    href: "/teacher/schedule",
    action: "Відкрити календар",
  },
  {
    id: "regular-lessons",
    category: "Уроки",
    title: "Регулярні заняття та журнал",
    summary: "Відмітка уроку й навчальний прогрес.",
    steps: [
      "Після заняття відмітьте його в календарі; обирайте стан, який відповідає фактичній ситуації.",
      "Додавайте тему та домашнє завдання в журналі учня, коли вони є.",
      "Якщо потрібен звіт про прогрес, система підкаже це після відмітки уроку.",
    ],
    href: "/teacher/students",
    action: "Мої учні",
  },
  {
    id: "schedule",
    category: "Розклад",
    title: "Перенесення, пропуски та відпустки",
    summary: "Де керувати змінами в розкладі.",
    steps: [
      "Перевіряйте оновлення у своєму календарі перед уроком.",
      "Фіксуйте пропуск або інший результат у картці заняття за фактом, а не наперед.",
      "Заплановану відсутність оформлюйте через сторінку відпусток. Якщо потрібна допомога зі зміною заняття, зверніться до менеджера.",
    ],
    href: "/teacher/vacations",
    action: "Мої відпустки",
  },
  {
    id: "payouts",
    category: "Фінанси",
    title: "Нарахування та виплати",
    summary: "Як читати суми на головній і детальну виписку.",
    steps: [
      "На головній перемикайте «Період виплати» та «Місяць». Період виплати охоплює два тижні; його точні дати показані під сумою.",
      "Сума на головній відображає нарахування за вибраний проміжок, включно з коригуваннями. Вона не означає залишок до виплати.",
      "На сторінці виплат переглядайте деталі періодів, ставок та окремих нарахувань.",
    ],
    href: "/teacher/payouts",
    action: "Переглянути виплати",
  },
  {
    id: "help",
    category: "Підтримка",
    title: "Коли щось пішло не так",
    summary: "Як швидше описати питання менеджеру.",
    steps: [
      "Запишіть дату, час уроку та ім’я учня; не передавайте пароль від свого облікового запису.",
      "Якщо проблема стосується нарахування, зазначте період виплати та конкретне заняття.",
      "Якщо заняття не відображається або його стан неправильний, повідомте менеджера, перш ніж вносити несуміжні зміни.",
    ],
    href: "/teacher/schedule",
    action: "Перевірити розклад",
  },
] as const;

export function TeacherKnowledgePage() {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const value = query.trim().toLocaleLowerCase("uk");
    if (!value) return articles;
    return articles.filter((article) =>
      [article.category, article.title, article.summary, ...article.steps]
        .some((piece) => piece.toLocaleLowerCase("uk").includes(value)),
    );
  }, [query]);

  return <PlatformShell allowedRoles={["TEACHER"]}>
    <div className="page-head">
      <div>
        <h1>База знань викладача</h1>
        <p className="muted">Короткі інструкції для щоденної роботи на платформі.</p>
      </div>
      <Link className="btn secondary" href="/teacher">На головну</Link>
    </div>
    <section className="card teacher-knowledge-intro">
      <div>
        <span className="teacher-knowledge-eyebrow">Підказки для роботи</span>
        <h2>Знайдіть відповідь і перейдіть одразу до потрібної дії</h2>
        <p className="muted">Правила для конкретного уроку й актуальні суми перевіряйте в його картці та у виписці.</p>
      </div>
      <label className="teacher-knowledge-search">
        <span>Пошук по базі знань</span>
        <input className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Наприклад, перший урок або виплати" />
      </label>
    </section>
    <div className="teacher-knowledge-count" role="status">Знайдено матеріалів: {filtered.length}</div>
    {filtered.length ? <div className="teacher-knowledge-grid">
      {filtered.map((article) => <article className="card teacher-knowledge-article" id={article.id} key={article.id}>
        <span className="teacher-knowledge-eyebrow">{article.category}</span>
        <h2>{article.title}</h2>
        <p className="muted">{article.summary}</p>
        <ol>{article.steps.map((step) => <li key={step}>{step}</li>)}</ol>
        <Link className="link-button" href={article.href}>{article.action} →</Link>
      </article>)}
    </div> : <div className="card empty">За цим запитом матеріалів немає. Спробуйте інше слово.</div>}
  </PlatformShell>;
}
