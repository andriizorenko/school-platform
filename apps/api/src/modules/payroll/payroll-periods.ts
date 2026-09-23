export type PayrollWindow = {
  periodStart: string;
  periodEnd: string;
  payoutWindowStart: string;
  payoutWindowEnd: string;
};

function parseIsoDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function payrollCycleIndex(anchorDate: string, targetDate: string, periodDays: number) {
  const anchor = parseIsoDate(anchorDate);
  const target = parseIsoDate(targetDate);
  const diff = Math.floor((target.getTime() - anchor.getTime()) / 86_400_000);
  return Math.floor(diff / periodDays);
}

export function payrollWindow(anchorDate: string, cycle: number, periodDays = 14, payoutWindowDays = 3): PayrollWindow {
  const anchor = parseIsoDate(anchorDate);
  const periodStart = addDays(anchor, cycle * periodDays);
  const periodEnd = addDays(periodStart, periodDays - 1);
  const payoutWindowStart = addDays(periodEnd, 1);
  const payoutWindowEnd = addDays(payoutWindowStart, payoutWindowDays - 1);
  return {
    periodStart: isoDate(periodStart),
    periodEnd: isoDate(periodEnd),
    payoutWindowStart: isoDate(payoutWindowStart),
    payoutWindowEnd: isoDate(payoutWindowEnd),
  };
}

export function payrollWindowsAround(
  anchorDate: string,
  targetDate: string,
  periodDays = 14,
  payoutWindowDays = 3,
  before = 2,
  after = 4,
) {
  const current = payrollCycleIndex(anchorDate, targetDate, periodDays);
  const windows: PayrollWindow[] = [];
  for (let cycle = current - before; cycle <= current + after; cycle += 1) {
    windows.push(payrollWindow(anchorDate, cycle, periodDays, payoutWindowDays));
  }
  return windows;
}

export function kyivDateIso(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
