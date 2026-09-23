const SCHOOL_TIME_ZONE = "Europe/Kyiv";

function partsFor(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

export function schoolLocalDateTimeToUtc(dateOnly: string, time: string, timeZone = SCHOOL_TIME_ZONE) {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = new Date(desired);

  for (let i = 0; i < 3; i += 1) {
    const observed = partsFor(guess, timeZone);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    const correction = desired - observedAsUtc;
    if (correction === 0) break;
    guess = new Date(guess.getTime() + correction);
  }

  return guess;
}

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

export function addDaysToDateOnly(dateOnly: string, days: number) {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isoDayOfWeek(dateOnly: string) {
  const day = new Date(`${dateOnly}T00:00:00.000Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function todayInSchoolTimeZone(timeZone = SCHOOL_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

export function availabilitySeasonForDate(
  dateOnly: string,
  schoolYearStart = "09-01",
  schoolYearEnd = "05-31",
): "SCHOOL_YEAR" | "SUMMER" {
  const monthDay = dateOnly.slice(5, 10);
  const inSchoolYear = schoolYearStart <= schoolYearEnd
    ? monthDay >= schoolYearStart && monthDay <= schoolYearEnd
    : monthDay >= schoolYearStart || monthDay <= schoolYearEnd;
  return inSchoolYear ? "SCHOOL_YEAR" : "SUMMER";
}

export function normalizeTime(time: string) {
  return time.length === 5 ? `${time}:00` : time;
}

export function minutesSinceMidnight(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

export function formatInSchoolTimeZone(date: Date, timeZone = SCHOOL_TIME_ZONE) {
  const parts = partsFor(date, timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    time: `${pad(parts.hour)}:${pad(parts.minute)}`,
  };
}
