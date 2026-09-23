import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Pool } from "pg";
import { DATABASE_POOL } from "../database/database.constants";
import { Public } from "../../modules/auth/public.decorator";

@Controller("health")
export class HealthController {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get()
  getHealth() {
    return {
      status: "ok",
      service: "school-api",
      environment: this.config.get("APP_ENV", this.config.get("NODE_ENV", "development")),
      uptimeSeconds: Math.floor(process.uptime()),
      releaseSha: String(this.config.get("RELEASE_SHA", "unknown")),
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get("live")
  getLiveness() {
    return { status: "live", timestamp: new Date().toISOString() };
  }

  @Public()
  @Get("ready")
  async getReadiness() {
    try {
      const started = Date.now();
      await this.pool.query("SELECT 1");
      return {
        status: "ready",
        database: "ok",
        databaseLatencyMs: Date.now() - started,
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException({
        code: "DATABASE_NOT_READY",
        message: "Database readiness check failed",
      });
    }
  }
  @Public()
  @Get("worker")
  async getWorkerReadiness() {
    const maxAgeSeconds = Number(this.config.get("WORKER_HEARTBEAT_MAX_AGE_SECONDS", 120));
    const result = await this.pool.query<{ last_seen_at: Date; release_sha: string | null }>(
      `SELECT last_seen_at,release_sha FROM service_heartbeats WHERE service_name='worker'`,
    );
    if (!result.rowCount) {
      throw new ServiceUnavailableException({ code: "WORKER_NOT_READY", message: "Worker heartbeat is missing" });
    }
    const row = result.rows[0];
    const ageSeconds = Math.max(0, Math.floor((Date.now() - new Date(row.last_seen_at).getTime()) / 1000));
    if (ageSeconds > maxAgeSeconds) {
      throw new ServiceUnavailableException({
        code: "WORKER_HEARTBEAT_STALE",
        message: "Worker heartbeat is stale",
        ageSeconds,
        maxAgeSeconds,
      });
    }
    return { status: "ready", service: "school-worker", ageSeconds, releaseSha: row.release_sha ?? "unknown", timestamp: new Date().toISOString() };
  }

}
