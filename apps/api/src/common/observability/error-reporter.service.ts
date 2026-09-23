import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JsonLogger } from "./json-logger.service";
import { redactValue } from "./redaction";

@Injectable()
export class ErrorReporter {
  constructor(private readonly config: ConfigService, private readonly logger: JsonLogger) {}

  async report(payload: Record<string, unknown>) {
    const url = String(this.config.get("ERROR_REPORTING_WEBHOOK_URL", "")).trim();
    if (!url) return;
    const timeoutMs = Number(this.config.get("ERROR_REPORTING_TIMEOUT_MS", 1500));
    const token = String(this.config.get("ERROR_REPORTING_WEBHOOK_TOKEN", "")).trim();
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(redactValue({ service: "school-api", timestamp: new Date().toISOString(), ...payload })),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) this.logger.warn(`Error reporting webhook returned HTTP ${response.status}`, "ErrorReporter");
    } catch (error) {
      this.logger.warn({ event: "error_report_delivery_failed", error }, "ErrorReporter");
    }
  }
}
