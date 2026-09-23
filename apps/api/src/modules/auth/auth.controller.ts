import { Body, Controller, Delete, Get, HttpException, Param, ParseUUIDPipe, Post, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { SecurityService } from "../../common/security/security.service";
import { AllowUnverifiedMfa } from "./allow-unverified-mfa.decorator";
import { AuthService } from "./auth.service";
import { CurrentUser } from "./current-user.decorator";
import { LoginDto } from "./dto/login.dto";
import { MfaCodeDto } from "./mfa.dto";
import { MfaService } from "./mfa.service";
import { Public } from "./public.decorator";
import type { AuthenticatedRequest, AuthUser } from "./types";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
    private readonly config: ConfigService,
    private readonly security: SecurityService,
  ) {}

  @Public()
  @Post("login")
  async login(@Body() dto: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const identityAllowed = await this.security.enforceLoginIdentity(request, response, dto.email);
    if (!identityAllowed) {
      throw new HttpException({ code: "RATE_LIMITED", message: "Too many login attempts. Please try again later." }, 429);
    }
    const result = await this.auth.login(dto.email, dto.password, request.headers["user-agent"]);
    const cookieName = this.config.get<string>("SESSION_COOKIE_NAME", "school_session");
    const isProduction = this.config.get<string>("NODE_ENV") === "production";
    response.cookie(cookieName, result.token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      expires: result.expiresAt,
      path: "/",
    });
    return { user: result.user, mfaRequired: result.mfaRequired, mfaSetupRequired: result.mfaSetupRequired };
  }

  @AllowUnverifiedMfa()
  @Post("logout")
  async logout(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    if (request.authSessionId) await this.auth.logout(request.authSessionId);
    const cookieName = this.config.get<string>("SESSION_COOKIE_NAME", "school_session");
    response.clearCookie(cookieName, { path: "/" });
    return { ok: true };
  }

  @AllowUnverifiedMfa()
  @Get("me")
  me(@CurrentUser() user: AuthUser, @Req() req: AuthenticatedRequest) {
    return { user, mfaVerified: Boolean(req.authMfaVerified) };
  }

  @Get("sessions")
  sessions(@CurrentUser() user: AuthUser, @Req() req: AuthenticatedRequest) {
    return this.auth.listSessions(user.id, req.authSessionId);
  }

  @Delete("sessions/:id")
  revokeSession(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.auth.revokeSession(user.id, id);
  }

  @AllowUnverifiedMfa()
  @Get("mfa/status")
  status(@CurrentUser() user: AuthUser) { return this.mfa.status(user.id); }

  @AllowUnverifiedMfa()
  @Post("mfa/setup")
  setup(@CurrentUser() user: AuthUser) { return this.mfa.setup(user.id, user.email); }

  @AllowUnverifiedMfa()
  @Post("mfa/enable")
  enable(@Body() dto: MfaCodeDto, @CurrentUser() user: AuthUser, @Req() req: AuthenticatedRequest) {
    return this.mfa.enable(user.id, req.authSessionId!, dto.code);
  }

  @AllowUnverifiedMfa()
  @Post("mfa/verify")
  verify(@Body() dto: MfaCodeDto, @CurrentUser() user: AuthUser, @Req() req: AuthenticatedRequest) {
    return this.mfa.verify(user.id, req.authSessionId!, dto.code);
  }
}
