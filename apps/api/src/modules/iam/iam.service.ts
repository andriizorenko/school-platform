import { Inject, Injectable } from "@nestjs/common";
import {
  permissions,
  rolePermissions,
  roles,
  temporaryPermissionGrants,
  userRoles,
} from "@school/db";
import { and, eq, gt, isNull, lte } from "drizzle-orm";
import type { Database } from "@school/db";
import { DATABASE } from "../../common/database/database.constants";

@Injectable()
export class IamService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async getUserAccess(userId: string) {
    const roleRows = await this.db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, userId));

    const permissionRows = await this.db
      .selectDistinct({ code: permissions.code })
      .from(userRoles)
      .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(userRoles.userId, userId));

    return {
      roles: roleRows.map((row) => row.code),
      permissions: permissionRows.map((row) => row.code),
    };
  }

  async hasTemporaryPermission(
    userId: string,
    permissionCode: string,
    scopeType: "GLOBAL" | "FAMILY" | "STUDENT" | "ENROLLMENT" | "SESSION",
    scopeId?: string,
  ) {
    const now = new Date();
    const [grant] = await this.db
      .select({ id: temporaryPermissionGrants.id })
      .from(temporaryPermissionGrants)
      .innerJoin(permissions, eq(temporaryPermissionGrants.permissionId, permissions.id))
      .where(
        and(
          eq(temporaryPermissionGrants.userId, userId),
          eq(permissions.code, permissionCode),
          eq(temporaryPermissionGrants.scopeType, scopeType),
          scopeType === "GLOBAL"
            ? isNull(temporaryPermissionGrants.scopeId)
            : eq(temporaryPermissionGrants.scopeId, scopeId ?? "00000000-0000-0000-0000-000000000000"),
          lte(temporaryPermissionGrants.startsAt, now),
          gt(temporaryPermissionGrants.expiresAt, now),
          isNull(temporaryPermissionGrants.revokedAt),
        ),
      )
      .limit(1);

    return Boolean(grant);
  }
}
