export function retryDelaySeconds(baseSeconds: number, attemptNumber: number, maxSeconds = 3600) {
  const safeBase = Math.max(1, Math.floor(baseSeconds));
  const safeAttempt = Math.max(1, Math.floor(attemptNumber));
  return Math.min(maxSeconds, safeBase * 2 ** (safeAttempt - 1));
}

export function lessonReminderDedupKey(sessionId: string, startsAt: Date) {
  return `lesson-reminder:${sessionId}:${startsAt.toISOString()}`;
}

export function unmarkedReminderDedupKey(sessionId: string, endsAt: Date) {
  return `unmarked:${sessionId}:${endsAt.toISOString()}`;
}

export function balanceNotificationDedupKey(kind: "low" | "zero", enrollmentId: string, balanceCycleId: string) {
  return `balance-${kind}:${enrollmentId}:${balanceCycleId}`;
}
