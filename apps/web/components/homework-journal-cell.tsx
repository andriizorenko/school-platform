"use client";

type Props = {
  assigned: boolean | null | undefined;
  description?: string | null;
  completedAt?: string | null;
  onToggle?: () => void;
  busy?: boolean;
};

export function HomeworkJournalCell({ assigned, description, completedAt, onToggle, busy = false }: Props) {
  if (!assigned) return <>Не задано</>;

  return (
    <div className="journal-homework">
      <span>Задано</span>
      {description && <span className="journal-homework-description">{description}</span>}
      <span className="journal-homework-status muted">
        {completedAt ? "Учень позначив виконаним" : "Учень ще не позначив виконаним"}
      </span>
      {onToggle && (
        <button
          className="link-button"
          type="button"
          aria-pressed={Boolean(completedAt)}
          disabled={busy}
          onClick={onToggle}
        >
          {busy ? "Зберігаємо…" : completedAt ? "Повернути в роботу" : "Позначити виконаним"}
        </button>
      )}
    </div>
  );
}
