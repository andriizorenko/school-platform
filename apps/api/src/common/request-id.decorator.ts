import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

export const RequestId = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<Request>();
  return request.header("x-request-id");
});
