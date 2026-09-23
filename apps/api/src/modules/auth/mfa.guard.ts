import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthenticatedRequest } from "./types";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { ALLOW_UNVERIFIED_MFA_KEY } from "./allow-unverified-mfa.decorator";

const MFA_ROLES = new Set(["ADMIN", "FINANCIER", "SUPPORT_MANAGER"]);

@Injectable()
export class MfaGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_UNVERIFIED_MFA_KEY, [context.getHandler(), context.getClass()]);
    if (allowed) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.authUser;
    if (!user) return true;
    if (!user.roles.some((role) => MFA_ROLES.has(role))) return true;
    if (request.authMfaVerified) return true;
    throw new ForbiddenException({ code: "MFA_REQUIRED", message: "Two-factor authentication is required" });
  }
}
