import { Inject, Injectable } from "@nestjs/common";
import { auditLogs } from "@school/db";
import type { Database } from "@school/db";
import { DATABASE } from "../../common/database/database.constants";

type AuditRecord = {
  actorUserId?: string;
  actorRoleCode?: string;
  action: string;
  entityType: string;
  entityId?: string;
  beforeData?: unknown;
  afterData?: unknown;
  requestId?: string;
  metadata?: unknown;
};

type AuditExecutor = Pick<Database, "insert">;

@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async record(entry: AuditRecord, executor: AuditExecutor = this.db) {
    await executor.insert(auditLogs).values({
      actorUserId: entry.actorUserId,
      actorRoleCode: entry.actorRoleCode,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      beforeData: entry.beforeData,
      afterData: entry.afterData,
      requestId: entry.requestId,
      metadata: entry.metadata,
    });
  }
}
