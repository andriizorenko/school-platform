import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthenticatedRequest } from "../auth/types";
import { IamService } from "./iam.service";
import { PERMISSION_SCOPE_KEY, type PermissionScopeMetadata } from "./permission-scope.decorator";
import { REQUIRED_PERMISSIONS_KEY } from "./require-permissions.decorator";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly iam: IamService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.authUser;

    if (!user) {
      throw new ForbiddenException({
        code: "PERMISSION_DENIED",
        message: "Permission denied",
      });
    }

    const granted = new Set(user.permissions);
    const missing = required.filter((permission) => !granted.has(permission));
    if (!missing.length) return true;

    const scope = this.reflector.getAllAndOverride<PermissionScopeMetadata>(PERMISSION_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (scope) {
      const routeParams = request.params ?? {};
      const scopeId = routeParams[scope.routeParam];
      const temporaryResults = await Promise.all(
        missing.map((permission) => this.iam.hasTemporaryPermission(user.id, permission, scope.scopeType, scopeId)),
      );
      if (temporaryResults.every(Boolean)) return true;
    }

    throw new ForbiddenException({
      code: "PERMISSION_DENIED",
      message: "Permission denied",
      details: { required },
    });
  }
}
