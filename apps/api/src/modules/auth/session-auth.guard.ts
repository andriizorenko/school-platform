import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import type { AuthenticatedRequest } from "./types";
import { AuthService } from "./auth.service";
import { IS_PUBLIC_KEY } from "./public.decorator";

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookieName = this.config.get<string>("SESSION_COOKIE_NAME", "school_session");
    const token = request.cookies?.[cookieName] as string | undefined;

    if (!token) throw new UnauthorizedException("Authentication required");

    const authenticated = await this.auth.authenticateToken(token);
    request.authUser = authenticated.user;
    request.authSessionId = authenticated.sessionId;
    request.authMfaVerified = authenticated.mfaVerified;
    return true;
  }
}
