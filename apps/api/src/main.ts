import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import { JsonLogger } from "./common/observability/json-logger.service";
import { MetricsService } from "./common/observability/metrics.service";
import { SecurityService } from "./common/security/security.service";
import { securityHeaders } from "./common/security/security-headers";
import { redactPath } from "./common/observability/redaction";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  const config = app.get(ConfigService);
  const logger = app.get(JsonLogger);
  const metrics = app.get(MetricsService);
  const security = app.get(SecurityService);
  app.useLogger(logger);
  app.enableShutdownHooks();

  const express = app.getHttpAdapter().getInstance();
  express.disable("x-powered-by");
  const trustProxyHops = Number(config.get("TRUST_PROXY_HOPS", 0));
  if (trustProxyHops > 0) express.set("trust proxy", trustProxyHops);

  app.setGlobalPrefix("api");
  app.use(cookieParser());
  app.use((request: Request, response: Response, next: NextFunction) => {
    const incoming = request.header("x-request-id")?.trim();
    const requestId = incoming && /^[A-Za-z0-9._:-]{1,128}$/.test(incoming) ? incoming : randomUUID();
    request.headers["x-request-id"] = requestId;
    response.setHeader("x-request-id", requestId);
    next();
  });
  app.use(securityHeaders(config));

  app.use(async (request: Request, response: Response, next: NextFunction) => {
    const started = process.hrtime.bigint();
    response.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      metrics.observeHttp(durationMs, request.method, response.statusCode);
      logger.event(response.statusCode >= 500 ? "error" : response.statusCode >= 400 ? "warn" : "log", "http_request", {
        requestId: request.header("x-request-id"),
        method: request.method,
        path: redactPath(request.path),
        status: response.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
        client: logger.hashIdentifier(request.ip || request.socket.remoteAddress),
      });
    });
    next();
  });

  app.use(async (request: Request, response: Response, next: NextFunction) => {
    try {
      const allowed = await security.enforceRateLimits(request, response);
      if (!allowed) {
        response.status(429).json({
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests. Please try again later.",
            requestId: request.header("x-request-id"),
          },
        });
        return;
      }
      next();
    } catch (error) {
      logger.error(error, undefined, "RateLimit");
      if (config.get<string>("NODE_ENV") === "production") {
        response.status(503).json({
          error: {
            code: "SECURITY_CONTROL_UNAVAILABLE",
            message: "Security control is temporarily unavailable.",
            requestId: request.header("x-request-id"),
          },
        });
        return;
      }
      next();
    }
  });

  const strictOrigin = config.get<boolean>("STRICT_ORIGIN_CHECK_ENABLED", config.get<string>("NODE_ENV") === "production");
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (!strictOrigin || !["POST", "PUT", "PATCH", "DELETE"].includes(request.method.toUpperCase())) return next();
    const serverIntegrationPaths = new Set([
      "/api/integrations/payments/liqpay/callback",
      "/api/integrations/payments/mono/webhook",
      "/api/integrations/telegram/webhook",
    ]);
    if (serverIntegrationPaths.has(request.path)) return next();
    const origin = request.header("origin");
    if (!origin || security.isAllowedOrigin(origin)) return next();
    metrics.increment("school_origin_rejections_total");
    response.status(403).json({
      error: {
        code: "ORIGIN_FORBIDDEN",
        message: "Request origin is not allowed.",
        requestId: request.header("x-request-id"),
      },
    });
  });

  const origins = security.allowedOrigins();
  app.enableCors({
    origin(
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) {
      if (!origin || origins.includes(origin.replace(/\/$/, ""))) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "x-request-id", "x-telegram-bot-api-secret-token", "x-sign"],
    exposedHeaders: ["x-request-id", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "retry-after"],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = config.get<number>("API_PORT", 3001);
  await app.listen(port);
  logger.event("log", "service_started", { port, environment: config.get("NODE_ENV", "development") });
}

void bootstrap();
