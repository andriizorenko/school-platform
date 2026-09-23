import type { NextFunction, Request, Response } from "express";
import type { ConfigService } from "@nestjs/config";

export function securityHeaders(config: ConfigService) {
  const production = config.get<string>("NODE_ENV") === "production";
  const enabled = config.get<boolean>("SECURITY_HEADERS_ENABLED", true);
  return (_request: Request, response: Response, next: NextFunction) => {
    if (enabled) {
      response.setHeader("x-content-type-options", "nosniff");
      response.setHeader("x-frame-options", "DENY");
      response.setHeader("referrer-policy", "strict-origin-when-cross-origin");
      response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
      response.setHeader("x-permitted-cross-domain-policies", "none");
      response.setHeader("x-xss-protection", "0");
      if (production) response.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
    }
    next();
  };
}
