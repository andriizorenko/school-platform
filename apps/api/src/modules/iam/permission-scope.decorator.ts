import { SetMetadata } from "@nestjs/common";

export const PERMISSION_SCOPE_KEY = "permission_scope";

export type PermissionScopeMetadata = {
  scopeType: "GLOBAL" | "FAMILY" | "STUDENT" | "ENROLLMENT" | "SESSION";
  routeParam: string;
};

export const PermissionScope = (
  scopeType: PermissionScopeMetadata["scopeType"],
  routeParam: string,
) => SetMetadata(PERMISSION_SCOPE_KEY, { scopeType, routeParam } satisfies PermissionScopeMetadata);
