export const money = (minor: number | string | null | undefined, currency = "UAH") =>
  new Intl.NumberFormat("uk-UA", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(minor ?? 0) / 100);

export const dateTime = (value: string | Date) =>
  new Intl.DateTimeFormat("uk-UA", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Kyiv" }).format(new Date(value));

export const timeOnly = (value: string | Date) =>
  new Intl.DateTimeFormat("uk-UA", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Kyiv" }).format(new Date(value));

export const dateOnly = (value: string | Date) =>
  new Intl.DateTimeFormat("uk-UA", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "Europe/Kyiv" }).format(new Date(value));

/** Convert an HTML datetime-local value representing Europe/Kyiv wall time into an ISO instant. */
export function kyivLocalDateTimeToIso(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) throw new Error("Некоректний формат дати й часу");
  const [, y, mo, d, h, mi] = m;
  const utcGuess = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Kyiv",
    timeZoneName: "longOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(utcGuess);
  const zone = parts.find(part => part.type === "timeZoneName")?.value ?? "GMT+02:00";
  const offsetMatch = /GMT([+-])(\d{2}):(\d{2})/.exec(zone);
  if (!offsetMatch) throw new Error("Не вдалося визначити часовий пояс Europe/Kyiv");
  const sign = offsetMatch[1] === "+" ? "+" : "-";
  return new Date(`${value}:00${sign}${offsetMatch[2]}:${offsetMatch[3]}`).toISOString();
}
