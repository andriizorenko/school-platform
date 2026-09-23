import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ErrorReporter } from "../observability/error-reporter.service";
import { JsonLogger } from "../observability/json-logger.service";
import { MetricsService } from "../observability/metrics.service";
import { redactPath } from "../observability/redaction";

function defaultCode(status: number) {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return "VALIDATION_ERROR";
    case HttpStatus.UNAUTHORIZED:
      return "UNAUTHORIZED";
    case HttpStatus.FORBIDDEN:
      return "FORBIDDEN";
    case HttpStatus.NOT_FOUND:
      return "NOT_FOUND";
    case HttpStatus.CONFLICT:
      return "CONFLICT";
    case HttpStatus.TOO_MANY_REQUESTS:
      return "RATE_LIMITED";
    default:
      return status >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR";
  }
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: JsonLogger,
    private readonly metrics: MetricsService,
    private readonly reporter: ErrorReporter,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = isHttpException ? exception.getResponse() : undefined;

    let message = "Internal server error";
    let details: unknown;

    if (typeof raw === "string") {
      message = raw;
    } else if (raw && typeof raw === "object") {
      const payload = raw as { message?: string | string[]; details?: unknown; code?: string };
      if (Array.isArray(payload.message)) {
        message = "Request validation failed";
        details = payload.message;
      } else if (typeof payload.message === "string") {
        message = payload.message;
      }
      details ??= payload.details;
    }

    if (status >= 500 && process.env.NODE_ENV === "production") {
      message = "Internal server error";
      details = undefined;
    }

    const code =
      raw && typeof raw === "object" && "code" in raw && typeof (raw as { code?: unknown }).code === "string"
        ? (raw as { code: string }).code
        : defaultCode(status);
    const requestId = request.header("x-request-id");

    if (status >= 500) {
      this.metrics.increment("school_unhandled_errors_total", { status: String(status) });
      this.logger.event("error", "request_failed", {
        requestId,
        method: request.method,
        path: redactPath(request.path),
        status,
        code,
        exception: exception instanceof Error ? (process.env.NODE_ENV === "production" ? { name: exception.name } : exception) : { name: "UnknownError" },
      });
      void this.reporter.report({
        requestId,
        method: request.method,
        path: redactPath(request.path),
        status,
        code,
        errorName: exception instanceof Error ? exception.name : "UnknownError",
      });
    }

    response.status(status).json({
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
        requestId,
      },
    });
  }
}
