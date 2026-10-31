import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Database } from "@school/db";
import { sql } from "drizzle-orm";
import { DATABASE } from "../../common/database/database.constants";
import { isPgUniqueViolation } from "../../common/database/pg-errors";
import type { AuthUser } from "../auth/types";
import type { CreateTeacherReviewDto } from "./dto/create-teacher-review.dto";

@Injectable()
export class TeacherReviewsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private requireRole(actor: AuthUser, role: string) {
    if (!actor.roles.includes(role)) {
      throw new ForbiddenException({ code: "TEACHER_REVIEW_SCOPE_DENIED", message: "This role cannot access teacher reviews" });
    }
  }

  async parentOpportunities(actor: AuthUser) {
    this.requireRole(actor, "PARENT");
    const rows = await this.db.execute(sql`SELECT DISTINCT ON (ls.actual_teacher_id)
        ls.id AS session_id, ls.starts_at, ls.actual_teacher_id AS teacher_id,
        tp.first_name AS teacher_first_name, tp.last_name AS teacher_last_name,
        st.first_name AS student_first_name, st.last_name AS student_last_name,
        sub.name AS subject_name, tr.id AS review_id, tr.status AS review_status
      FROM live_sessions ls
      JOIN students st ON st.id=ls.student_id
      JOIN parent_profiles pp ON pp.family_id=st.family_id
      JOIN teacher_profiles tp ON tp.user_id=ls.actual_teacher_id
      JOIN subjects sub ON sub.id=ls.subject_id
      LEFT JOIN teacher_reviews tr ON tr.parent_id=pp.user_id AND tr.teacher_id=ls.actual_teacher_id
      WHERE pp.user_id=${actor.id} AND ls.status='COMPLETED' AND ls.ends_at <= now()
      ORDER BY ls.actual_teacher_id, ls.starts_at DESC
      LIMIT 100`);
    return rows.rows;
  }

  async create(actor: AuthUser, dto: CreateTeacherReviewDto) {
    this.requireRole(actor, "PARENT");
    const session = await this.db.execute(sql`SELECT ls.actual_teacher_id AS teacher_id
      FROM live_sessions ls
      JOIN students st ON st.id=ls.student_id
      JOIN parent_profiles pp ON pp.family_id=st.family_id
      WHERE ls.id=${dto.sessionId}::uuid AND pp.user_id=${actor.id}
        AND ls.status='COMPLETED' AND ls.ends_at <= now()
      LIMIT 1`);
    if (!session.rowCount) {
      throw new ForbiddenException({ code: "TEACHER_REVIEW_LESSON_REQUIRED", message: "A completed lesson in your family is required" });
    }
    const teacherId = (session.rows[0] as { teacher_id: string }).teacher_id;
    try {
      const result = await this.db.execute(sql`INSERT INTO teacher_reviews
        (parent_id, teacher_id, session_id, rating, comment)
        VALUES (${actor.id}, ${teacherId}, ${dto.sessionId}::uuid, ${dto.rating}, ${dto.comment.trim()})
        RETURNING id, status`);
      return result.rows[0];
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        throw new ConflictException({ code: "TEACHER_REVIEW_ALREADY_EXISTS", message: "Your family has already reviewed this teacher" });
      }
      throw error;
    }
  }

  async mine(actor: AuthUser) {
    this.requireRole(actor, "TEACHER");
    const rows = await this.db.execute(sql`SELECT tr.id, tr.rating, tr.comment, tr.created_at,
        pp.first_name AS parent_first_name, pp.last_name AS parent_last_name,
        st.first_name AS student_first_name, sub.name AS subject_name
      FROM teacher_reviews tr
      JOIN parent_profiles pp ON pp.user_id=tr.parent_id
      JOIN live_sessions ls ON ls.id=tr.session_id
      JOIN students st ON st.id=ls.student_id
      JOIN subjects sub ON sub.id=ls.subject_id
      WHERE tr.teacher_id=${actor.id} AND tr.status='APPROVED'
      ORDER BY tr.created_at DESC LIMIT 100`);
    return rows.rows;
  }

  async pending(actor: AuthUser) {
    this.requireRole(actor, "ADMIN");
    const rows = await this.db.execute(sql`SELECT tr.id, tr.rating, tr.comment, tr.created_at, tr.status,
        pp.first_name AS parent_first_name, pp.last_name AS parent_last_name,
        tp.first_name AS teacher_first_name, tp.last_name AS teacher_last_name,
        st.first_name AS student_first_name, st.last_name AS student_last_name,
        ls.starts_at, sub.name AS subject_name
      FROM teacher_reviews tr
      JOIN parent_profiles pp ON pp.user_id=tr.parent_id
      JOIN teacher_profiles tp ON tp.user_id=tr.teacher_id
      JOIN live_sessions ls ON ls.id=tr.session_id
      JOIN students st ON st.id=ls.student_id
      JOIN subjects sub ON sub.id=ls.subject_id
      WHERE tr.status='PENDING'
      ORDER BY tr.created_at ASC LIMIT 100`);
    return rows.rows;
  }

  async moderate(actor: AuthUser, id: string, status: "APPROVED" | "REJECTED") {
    this.requireRole(actor, "ADMIN");
    const result = await this.db.execute(sql`UPDATE teacher_reviews
      SET status=${status}, moderated_by=${actor.id}, moderated_at=now()
      WHERE id=${id}::uuid AND status='PENDING'
      RETURNING id, status`);
    if (!result.rowCount) {
      throw new NotFoundException({ code: "TEACHER_REVIEW_NOT_PENDING", message: "Review is not awaiting moderation" });
    }
    return result.rows[0];
  }
}
