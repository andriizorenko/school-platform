import type { Request } from "express";

export type AuthUser = {
  id: string;
  email: string;
  roles: string[];
  permissions: string[];
};

export type AuthenticatedRequest = Request & {
  authUser?: AuthUser;
  authSessionId?: string;
  authMfaVerified?: boolean;
};
