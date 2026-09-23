import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { subjects } from "@school/db";
import type { Database } from "@school/db";
import { asc, eq, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database/database.constants";
import { isPgUniqueViolation } from "../../common/database/pg-errors";
import type { AuthUser } from "../auth/types";
import { AuditService } from "../audit/audit.service";
import type { CreateSubjectDto } from "./dto/create-subject.dto";
import type { UpdateSubjectDto } from "./dto/update-subject.dto";

@Injectable()
export class SubjectsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateSubjectDto, actor: AuthUser, requestId?: string) {
    try {
      return await this.db.transaction(async (tx) => {
        const [subject] = await tx
          .insert(subjects)
          .values({ name: dto.name.trim(), slug: dto.slug.trim().toLowerCase() })
          .returning();

        await this.audit.record({
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "CREATE_SUBJECT",
          entityType: "Subject",
          entityId: subject.id,
          requestId,
          afterData: { name: subject.name, slug: subject.slug, status: subject.status },
        }, tx);

        return subject;
      });
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        throw new ConflictException({ code: "SUBJECT_SLUG_ALREADY_EXISTS", message: "A subject with this slug already exists" });
      }
      throw error;
    }
  }

  list() {
    return this.db
      .select({ id: subjects.id, name: subjects.name, slug: subjects.slug, status: subjects.status })
      .from(subjects)
      .orderBy(asc(subjects.name));
  }

  async getById(subjectId: string) {
    const [subject] = await this.db.select().from(subjects).where(eq(subjects.id, subjectId)).limit(1);
    if (!subject) throw new NotFoundException({ code: "SUBJECT_NOT_FOUND", message: "Subject not found" });
    return subject;
  }

  async update(subjectId: string, dto: UpdateSubjectDto, actor: AuthUser, requestId?: string) {
    try {
      return await this.db.transaction(async (tx) => {
        const currentResult = await tx.execute(sql`SELECT * FROM subjects WHERE id=${subjectId} FOR UPDATE`);
        if (!currentResult.rowCount) throw new NotFoundException({ code: "SUBJECT_NOT_FOUND", message: "Subject not found" });
        const current = currentResult.rows[0] as any;

        if (dto.status === "ARCHIVED" && current.status !== "ARCHIVED") {
          const active = await tx.execute(sql`
            SELECT
              EXISTS(SELECT 1 FROM student_subject_enrollments WHERE subject_id=${subjectId} AND status IN ('ACTIVE','PAUSED')) AS has_enrollments,
              EXISTS(SELECT 1 FROM courses WHERE subject_id=${subjectId} AND status='PUBLISHED') AS has_courses
          `);
          const flags = active.rows[0] as any;
          if (flags.has_enrollments || flags.has_courses) {
            throw new ConflictException({
              code: "SUBJECT_STILL_IN_USE",
              message: "Archive active enrollments and published courses before archiving this subject",
              details: { hasActiveEnrollments: flags.has_enrollments, hasPublishedCourses: flags.has_courses },
            });
          }
        }

        const nextStatus = dto.status ?? current.status;
        const result = await tx.execute(sql`
          UPDATE subjects
          SET
            name=${dto.name?.trim() ?? current.name},
            slug=${dto.slug?.trim().toLowerCase() ?? current.slug},
            status=${nextStatus}::subject_status,
            archived_at=CASE WHEN ${nextStatus}='ARCHIVED' THEN COALESCE(archived_at, now()) ELSE NULL END
          WHERE id=${subjectId}
          RETURNING *
        `);
        const updated = result.rows[0] as any;

        await this.audit.record({
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "UPDATE_SUBJECT",
          entityType: "Subject",
          entityId: subjectId,
          requestId,
          beforeData: { name: current.name, slug: current.slug, status: current.status },
          afterData: { name: updated.name, slug: updated.slug, status: updated.status },
        }, tx as any);
        return updated;
      });
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        throw new ConflictException({ code: "SUBJECT_SLUG_ALREADY_EXISTS", message: "A subject with this slug already exists" });
      }
      throw error;
    }
  }
}
