"use client";
export function LoadingCard({ text = "Завантаження…" }: { text?: string }) { return <div className="card muted">{text}</div>; }
export function ErrorCard({ error }: { error: unknown }) { return <div className="error">{error instanceof Error ? error.message : "Сталася помилка"}</div>; }
