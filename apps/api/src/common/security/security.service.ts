import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac } from "node:crypto";
import type { Request, Response } from "express";
import type { Pool } from "pg";
import { Inject } from "@nestjs/common";
import { DATABASE_POOL } from "../database/database.constants";
import { MetricsService } from "../observability/metrics.service";

type LimitResult = { allowed: boolean; remaining: number; resetAt: Date; limit: number };

type Profile = {
  name: string;
  limit: number;
  windowSeconds: number;
  extraKey?: (request: Request) => string | undefined;
};

@Injectable()
export class SecurityService {
  private cleanupCounter = 0;
  private readonly hashKey: string;

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {
    this.hashKey = String(this.config.get("RATE_LIMIT_HASH_KEY", "development-rate-limit-hash-key"));
  }

  allowedOrigins() {
    const webUrl = String(this.config.get("WEB_URL", "http://localhost:3000")).replace(/\/$/, "");
    const extra = String(this.config.get("CORS_ALLOWED_ORIGINS", ""))
      .split(",")
      .map((item) => item.trim().replace(/\/$/, ""))
      .filter(Boolean);
    return [...new Set([webUrl, ...extra])];
  }

  isAllowedOrigin(origin: string) {
    return this.allowedOrigins().includes(origin.replace(/\/$/, ""));
  }

  private hash(value: string) {
    return createHmac("sha256", this.hashKey).update(value).digest("hex");
  }

  private profileFor(request: Request): Profile[] {
    const method = request.method.toUpperCase();
    const path = request.path;
    const profiles: Profile[] = [];

    if (method === "POST" && path === "/api/auth/login") {
      profiles.push({
        name: "auth_login_ip",
        limit: Number(this.config.get("RATE_LIMIT_LOGIN_IP_MAX", 12)),
        windowSeconds: Number(this.config.get("RATE_LIMIT_LOGIN_WINDOW_SECONDS", 900)),
      });
    }

    if (method === "POST" && ["/api/auth/mfa/verify", "/api/auth/mfa/enable"].includes(path)) {
      profiles.push({
        name: "auth_mfa_ip",
        limit: Number(this.config.get("RATE_LIMIT_MFA_IP_MAX", 15)),
        windowSeconds: Number(this.config.get("RATE_LIMIT_MFA_WINDOW_SECONDS", 600)),
      });
    }

    if (method === "POST" && path === "/api/integrations/payments/liqpay/callback") {
      profiles.push({
        name: "webhook_liqpay_ip",
        limit: Number(this.config.get("RATE_LIMIT_WEBHOOK_IP_MAX", 180)),
        windowSeconds: Number(this.config.get("RATE_LIMIT_WEBHOOK_WINDOW_SECONDS", 60)),
      });
    }

    if (method === "POST" && path === "/api/integrations/payments/mono/webhook") {
      profiles.push({
        name: "webhook_mono_ip",
        limit: Number(this.config.get("RATE_LIMIT_WEBHOOK_IP_MAX", 180)),
        windowSeconds: Number(this.config.get("RATE_LIMIT_WEBHOOK_WINDOW_SECONDS", 60)),
      });
    }

    if (method === "POST" && path === "/api/integrations/telegram/webhook") {
      profiles.push({
        name: "webhook_telegram_ip",
        limit: Number(this.config.get("RATE_LIMIT_WEBHOOK_IP_MAX", 180)),
        windowSeconds: Number(this.config.get("RATE_LIMIT_WEBHOOK_WINDOW_SECONDS", 60)),
      });
    }

    return profiles;
  }

  private async consume(bucketKey: string, limit: number, windowSeconds: number): Promise<LimitResult> {
    const result = await this.pool.query<{
      hit_count: number;
      window_started_at: Date;
    }>(
      `
      INSERT INTO api_rate_limit_buckets(bucket_key, window_started_at, hit_count, updated_at)
      VALUES ($1, now(), 1, now())
      ON CONFLICT (bucket_key) DO UPDATE SET
        hit_count = CASE
          WHEN api_rate_limit_buckets.window_started_at <= now() - ($2 * interval '1 second') THEN 1
          ELSE api_rate_limit_buckets.hit_count + 1
        END,
        window_started_at = CASE
          WHEN api_rate_limit_buckets.window_started_at <= now() - ($2 * interval '1 second') THEN now()
          ELSE api_rate_limit_buckets.window_started_at
        END,
        updated_at = now()
      RETURNING hit_count, window_started_at
      `,
      [bucketKey, windowSeconds],
    );
    const row = result.rows[0];
    const count = Number(row.hit_count);
    const resetAt = new Date(new Date(row.window_started_at).getTime() + windowSeconds * 1000);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetAt, limit };
  }

  async enforceLoginIdentity(request: Request, response: Response, email: string) {
    if (!this.config.get<boolean>("RATE_LIMIT_ENABLED", true)) return true;
    const client = request.ip || request.socket.remoteAddress || "unknown";
    const subject = `${this.hash(client)}:${this.hash(email.trim().toLowerCase())}`;
    const limit = Number(this.config.get("RATE_LIMIT_LOGIN_IDENTITY_MAX", 8));
    const windowSeconds = Number(this.config.get("RATE_LIMIT_LOGIN_WINDOW_SECONDS", 900));
    const result = await this.consume(`auth_login_identity:${subject}`, limit, windowSeconds);
    response.setHeader("x-ratelimit-limit", String(result.limit));
    response.setHeader("x-ratelimit-remaining", String(result.remaining));
    response.setHeader("x-ratelimit-reset", String(Math.ceil(result.resetAt.getTime() / 1000)));
    if (!result.allowed) {
      const retryAfter = Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000));
      response.setHeader("retry-after", String(retryAfter));
      this.metrics.increment("school_rate_limit_rejections_total", { profile: "auth_login_identity" });
      return false;
    }
    return true;
  }

  async enforceRateLimits(request: Request, response: Response) {
    if (!this.config.get<boolean>("RATE_LIMIT_ENABLED", true)) return true;
    const profiles = this.profileFor(request);
    if (!profiles.length) return true;
    const client = request.ip || request.socket.remoteAddress || "unknown";
    const clientHash = this.hash(client);

    for (const profile of profiles) {
      const extra = profile.extraKey?.(request);
      if (profile.extraKey && !extra) continue;
      const subject = extra ? `${clientHash}:${this.hash(extra)}` : clientHash;
      const bucketKey = `${profile.name}:${subject}`;
      const result = await this.consume(bucketKey, profile.limit, profile.windowSeconds);
      response.setHeader("x-ratelimit-limit", String(result.limit));
      response.setHeader("x-ratelimit-remaining", String(result.remaining));
      response.setHeader("x-ratelimit-reset", String(Math.ceil(result.resetAt.getTime() / 1000)));
      if (!result.allowed) {
        const retryAfter = Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000));
        response.setHeader("retry-after", String(retryAfter));
        this.metrics.increment("school_rate_limit_rejections_total", { profile: profile.name });
        return false;
      }
    }

    this.cleanupCounter += 1;
    if (this.cleanupCounter >= 500) {
      this.cleanupCounter = 0;
      void this.pool.query("DELETE FROM api_rate_limit_buckets WHERE updated_at < now() - interval '2 days'").catch(() => undefined);
    }
    return true;
  }
}
