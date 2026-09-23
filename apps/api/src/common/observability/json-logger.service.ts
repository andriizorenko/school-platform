import { Injectable, LoggerService } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac } from "node:crypto";
import { redactValue } from "./redaction";

type Level = "debug" | "log" | "warn" | "error";
const LEVEL_WEIGHT: Record<Level, number> = { debug: 10, log: 20, warn: 30, error: 40 };

@Injectable()
export class JsonLogger implements LoggerService {
  private readonly minLevel: Level;
  private readonly hashKey: string;

  constructor(private readonly config: ConfigService) {
    const configured = String(config.get("LOG_LEVEL", "log")).toLowerCase();
    this.minLevel = (configured in LEVEL_WEIGHT ? configured : "log") as Level;
    this.hashKey = String(config.get("LOG_HASH_KEY", ""));
  }

  private context(optionalParams: unknown[]) {
    const last = optionalParams.at(-1);
    return typeof last === "string" ? last : undefined;
  }

  private write(level: Level, message: unknown, context?: string, extra?: Record<string, unknown>) {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.minLevel]) return;
    const record = {
      timestamp: new Date().toISOString(),
      level,
      service: "school-api",
      ...(context ? { context } : {}),
      message: typeof message === "string" ? message : redactValue(message),
      ...(extra ? (redactValue(extra) as Record<string, unknown>) : {}),
    };
    const line = JSON.stringify(record);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }

  log(message: unknown, ...optionalParams: unknown[]) { this.write("log", message, this.context(optionalParams)); }
  warn(message: unknown, ...optionalParams: unknown[]) { this.write("warn", message, this.context(optionalParams)); }
  debug(message: unknown, ...optionalParams: unknown[]) { this.write("debug", message, this.context(optionalParams)); }
  verbose(message: unknown, ...optionalParams: unknown[]) { this.write("debug", message, this.context(optionalParams)); }
  error(message: unknown, ...optionalParams: unknown[]) {
    const context = this.context(optionalParams);
    const trace = process.env.NODE_ENV !== "production" && optionalParams.length > 1 && typeof optionalParams[0] === "string"
      ? optionalParams[0]
      : undefined;
    this.write("error", message, context, trace ? { trace } : undefined);
  }

  event(level: Level, event: string, fields: Record<string, unknown> = {}) {
    this.write(level, event, "event", { event, ...fields });
  }

  hashIdentifier(value: string | undefined | null) {
    if (!value || !this.hashKey) return undefined;
    return createHmac("sha256", this.hashKey).update(value).digest("hex").slice(0, 20);
  }
}
