const SENSITIVE_KEY = /(authorization|cookie|password|secret|token|signature|private[_-]?key|api[_-]?key|x-sign)/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+\-/]+=*/gi;

export function redactText(value: string) {
  return value
    .replace(BEARER, "Bearer [REDACTED]")
    .replace(EMAIL, "[REDACTED_EMAIL]")
    .replace(/(password|secret|token|signature|private[_-]?key|api[_-]?key)=([^\s&]+)/gi, "$1=[REDACTED]");
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[MAX_DEPTH]";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return redactText(value);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      ...(process.env.NODE_ENV !== "production" && value.stack ? { stack: redactText(value.stack) } : {}),
    };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactValue(item, depth + 1));
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      output[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactValue(item, depth + 1);
    }
    return output;
  }
  return redactText(String(value));
}

export function redactPath(value: string) {
  return value
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, ":id")
    .replace(/\b\d{8,}\b/g, ":id");
}
