import {
  bigint,
  bigserial,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  smallserial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth.js";

export const permissionScopeTypeEnum = pgEnum("permission_scope_type", [
  "GLOBAL",
  "FAMILY",
  "STUDENT",
  "ENROLLMENT",
  "SESSION",
]);

export const roles = pgTable(
  "roles",
  {
    id: smallserial("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
  },
  (table) => [uniqueIndex("roles_code_uidx").on(table.code)],
);

export const permissions = pgTable(
  "permissions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    code: text("code").notNull(),
    description: text("description"),
  },
  (table) => [uniqueIndex("permissions_code_uidx").on(table.code)],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: smallint("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    assignedBy: uuid("assigned_by").references(() => users.id, { onDelete: "restrict" }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.roleId] }), index("user_roles_role_idx").on(table.roleId)],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: smallint("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: bigint("permission_id", { mode: "number" })
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionId] })],
);

export const temporaryPermissionGrants = pgTable(
  "temporary_permission_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    permissionId: bigint("permission_id", { mode: "number" })
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    scopeType: permissionScopeTypeEnum("scope_type").notNull(),
    scopeId: uuid("scope_id"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    grantedBy: uuid("granted_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("temporary_permission_grants_user_idx").on(table.userId),
    index("temporary_permission_grants_expiry_idx").on(table.expiresAt),
  ],
);
