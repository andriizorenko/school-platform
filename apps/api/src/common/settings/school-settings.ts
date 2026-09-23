import { sql } from "drizzle-orm";

export async function numberSchoolSetting(executor: any, key: string, fallback: number) {
  const result = await executor.execute(sql`SELECT value FROM school_settings WHERE key=${key} LIMIT 1`);
  if (!result.rowCount) return fallback;
  const raw = (result.rows[0] as { value: unknown }).value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function stringSchoolSetting(executor: any, key: string, fallback: string) {
  const result = await executor.execute(sql`SELECT value FROM school_settings WHERE key=${key} LIMIT 1`);
  if (!result.rowCount) return fallback;
  const raw = (result.rows[0] as { value: unknown }).value;
  return typeof raw === "string" && raw.trim() ? raw : fallback;
}

export async function availabilitySeasonForDateSetting(executor: any, dateOnly: string): Promise<"SCHOOL_YEAR"|"SUMMER"> {
  const start = await stringSchoolSetting(executor, "school_year_start", "09-01");
  const end = await stringSchoolSetting(executor, "school_year_end", "05-31");
  const monthDay = dateOnly.slice(5, 10);
  const inSchoolYear = start <= end ? monthDay >= start && monthDay <= end : monthDay >= start || monthDay <= end;
  return inSchoolYear ? "SCHOOL_YEAR" : "SUMMER";
}
