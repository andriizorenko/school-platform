import { Injectable } from "@nestjs/common";

@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, number>();
  private durationMsSum = 0;
  private durationCount = 0;

  increment(name: string, labels: Record<string, string> = {}, amount = 1) {
    const normalized = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
    const key = `${name}|${JSON.stringify(normalized)}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + amount);
  }

  observeHttp(durationMs: number, method: string, status: number) {
    this.durationMsSum += durationMs;
    this.durationCount += 1;
    this.increment("school_http_requests_total", {
      method: method.toUpperCase(),
      status_class: `${Math.floor(status / 100)}xx`,
    });
  }

  renderPrometheus() {
    const lines = [
      "# HELP school_process_uptime_seconds Process uptime in seconds.",
      "# TYPE school_process_uptime_seconds gauge",
      `school_process_uptime_seconds ${process.uptime().toFixed(3)}`,
      "# HELP school_http_request_duration_ms_sum Sum of HTTP request durations in milliseconds.",
      "# TYPE school_http_request_duration_ms_sum counter",
      `school_http_request_duration_ms_sum ${this.durationMsSum.toFixed(3)}`,
      "# HELP school_http_request_duration_ms_count Count of observed HTTP requests.",
      "# TYPE school_http_request_duration_ms_count counter",
      `school_http_request_duration_ms_count ${this.durationCount}`,
    ];
    for (const [key, value] of [...this.counters.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const separator = key.indexOf("|");
      const name = key.slice(0, separator);
      const labels = JSON.parse(key.slice(separator + 1)) as Array<[string, string]>;
      const labelText = labels.length
        ? `{${labels.map(([label, item]) => `${label}="${item.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`
        : "";
      lines.push(`${name}${labelText} ${value}`);
    }
    return `${lines.join("\n")}\n`;
  }
}
