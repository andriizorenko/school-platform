type PgLikeError = {
  code?: unknown;
  constraint?: unknown;
};

export function isPgUniqueViolation(error: unknown): error is PgLikeError {
  return Boolean(error && typeof error === "object" && (error as PgLikeError).code === "23505");
}

export function isPgExclusionViolation(error: unknown): error is PgLikeError {
  return Boolean(error && typeof error === "object" && (error as PgLikeError).code === "23P01");
}

export function pgConstraint(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const constraint = (error as PgLikeError).constraint;
  return typeof constraint === "string" ? constraint : undefined;
}
