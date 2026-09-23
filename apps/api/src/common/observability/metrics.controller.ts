import { Controller, Get, Header, NotFoundException, Req, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { Public } from "../../modules/auth/public.decorator";
import { MetricsService } from "./metrics.service";

function secureEqual(expected: string, supplied: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

@Controller("metrics")
export class MetricsController {
  constructor(private readonly metrics: MetricsService, private readonly config: ConfigService) {}

  @Public()
  @Get()
  @Header("content-type", "text/plain; version=0.0.4; charset=utf-8")
  getMetrics(@Req() request: Request) {
    if (!this.config.get<boolean>("METRICS_ENABLED", false)) throw new NotFoundException();
    const expected = String(this.config.get("METRICS_TOKEN", ""));
    const supplied = request.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (expected && !secureEqual(expected, supplied)) throw new UnauthorizedException("Metrics token is invalid");
    return this.metrics.renderPrometheus();
  }
}
