"use client";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path.startsWith("/") ? path : `/${path}`}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body && !(init.body instanceof FormData) ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload?.error ?? payload ?? {};
    throw new ApiError(response.status, error.code ?? "API_ERROR", error.message ?? "Помилка запиту", error.details);
  }
  return payload as T;
}

export type Me = { id: string; email: string; roles: string[]; permissions: string[] };

export function roleHome(roles: string[]) {
  if (roles.includes("ADMIN") || roles.includes("SUPPORT_MANAGER")) return "/admin";
  if (roles.includes("MANAGER")) return "/manager";
  if (roles.includes("FINANCIER")) return "/financier";
  if (roles.includes("TEACHER")) return "/teacher";
  if (roles.includes("PARENT")) return "/parent";
  if (roles.includes("STUDENT")) return "/student";
  return "/profile";
}
