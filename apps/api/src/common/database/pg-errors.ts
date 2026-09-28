type PgLikeError = {
  code?: unknown;
  constraint?: unknown;
  cause?: unknown;
};

function pgErrorChain(error: unknown): PgLikeError[] {
  const chain: PgLikeError[] = [];
  const seen = new Set<unknown>();
  let current = error;

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    chain.push(current as PgLikeError);
    current = (current as PgLikeError).cause;
  }

  return chain;
}

export function isPgUniqueViolation(error: unknown): error is PgLikeError {
  return pgErrorChain(error).some((item) => item.code === "23505");
}

export function isPgExclusionViolation(error: unknown): error is PgLikeError {
  return pgErrorChain(error).some((item) => item.code === "23P01");
}

export function pgConstraint(error: unknown): string | undefined {
  for (const item of pgErrorChain(error)) {
    if (typeof item.constraint === "string") return item.constraint;
  }
  return undefined;
}
