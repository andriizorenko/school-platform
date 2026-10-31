import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  roles,
  subjects,
  teacherProfiles,
  teacherRateVersions,
  teacherSubjects,
  userRoles,
  users,
} from "@school/db";
import type { Database } from "@school/db";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database/database.constants";
import { isPgExclusionViolation, isPgUniqueViolation } from "../../common/database/pg-errors";
import type { AuthUser } from "../auth/types";
import { AuditService } from "../audit/audit.service";
import type { AddTeacherSubjectDto } from "./dto/add-teacher-subject.dto";
import type { CreateTeacherDto } from "./dto/create-teacher.dto";
import type { CreateTeacherRateDto } from "./dto/create-teacher-rate.dto";
import type { UpdateTeacherDto } from "./dto/update-teacher.dto";
import type { UpdateMyTeacherProfileDto } from "./dto/update-my-teacher-profile.dto";

@Injectable()
export class TeachersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateTeacherDto, actor: AuthUser, requestId?: string) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.db.query.users.findFirst({
      where: eq(users.email, email),
      columns: { id: true },
    });

    if (existing) {
      throw new ConflictException({
        code: "EMAIL_ALREADY_IN_USE",
        message: "This email is already used by another account",
      });
    }

    try {
      return await this.db.transaction(async (tx) => {
        const [teacherRole] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.code, "TEACHER")).limit(1);
        if (!teacherRole) throw new Error("TEACHER role is not seeded");

        const [user] = await tx
          .insert(users)
          .values({ email, status: "PENDING" })
          .returning({ id: users.id, email: users.email, status: users.status });

        await tx.insert(userRoles).values({
          userId: user.id,
          roleId: teacherRole.id,
          assignedBy: actor.id,
        });

        const [profile] = await tx
          .insert(teacherProfiles)
          .values({
            userId: user.id,
            firstName: dto.firstName.trim(),
            lastName: dto.lastName.trim(),
            phone: dto.phone.trim(),
            zoomUrl: dto.zoomUrl?.trim(),
            startedAt: dto.startedAt,
            status: "INVITED",
          })
          .returning();

        await this.audit.record(
          {
            actorUserId: actor.id,
            actorRoleCode: actor.roles[0],
            action: "CREATE_TEACHER_ACCOUNT",
            entityType: "TeacherProfile",
            entityId: user.id,
            requestId,
            afterData: {
              email,
              firstName: profile.firstName,
              lastName: profile.lastName,
              status: profile.status,
            },
          },
          tx,
        );

        return { ...profile, email: user.email, userStatus: user.status };
      });
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        throw new ConflictException({ code: "TEACHER_CREATE_CONFLICT", message: "Teacher could not be created" });
      }
      throw error;
    }
  }

  async list() {
    const rows = await this.db
      .select({
        userId: teacherProfiles.userId,
        email: users.email,
        userStatus: users.status,
        firstName: teacherProfiles.firstName,
        lastName: teacherProfiles.lastName,
        phone: teacherProfiles.phone,
        zoomUrl: teacherProfiles.zoomUrl,
        teacherStatus: teacherProfiles.status,
        startedAt: teacherProfiles.startedAt,
        archivedAt: teacherProfiles.archivedAt,
        subjectId: subjects.id,
        subjectName: subjects.name,
        teacherSubjectActive: teacherSubjects.isActive,
      })
      .from(teacherProfiles)
      .innerJoin(users, eq(teacherProfiles.userId, users.id))
      .leftJoin(teacherSubjects, eq(teacherProfiles.userId, teacherSubjects.teacherId))
      .leftJoin(subjects, eq(teacherSubjects.subjectId, subjects.id))
      .orderBy(asc(teacherProfiles.lastName), asc(teacherProfiles.firstName));

    const grouped = new Map<string, {
      userId: string;
      email: string;
      userStatus: string;
      firstName: string;
      lastName: string;
      phone: string;
      zoomUrl: string | null;
      teacherStatus: string;
      startedAt: string | null;
      archivedAt: Date | null;
      subjects: Array<{ id: string; name: string; isActive: boolean }>;
    }>();

    for (const row of rows) {
      let teacher = grouped.get(row.userId);
      if (!teacher) {
        teacher = {
          userId: row.userId,
          email: row.email,
          userStatus: row.userStatus,
          firstName: row.firstName,
          lastName: row.lastName,
          phone: row.phone,
          zoomUrl: row.zoomUrl,
          teacherStatus: row.teacherStatus,
          startedAt: row.startedAt,
          archivedAt: row.archivedAt,
          subjects: [],
        };
        grouped.set(row.userId, teacher);
      }

      if (row.subjectId && row.subjectName && row.teacherSubjectActive !== null) {
        teacher.subjects.push({
          id: row.subjectId,
          name: row.subjectName,
          isActive: row.teacherSubjectActive,
        });
      }
    }

    return [...grouped.values()];
  }


  async myConversion(actor: AuthUser) {
    if (!actor.roles.includes("TEACHER")) {
      throw new ForbiddenException({ code: "TEACHER_CONVERSION_SCOPE_DENIED", message: "Teacher account required" });
    }
    const result = await this.db.execute(sql`
      WITH first_lessons AS (
        SELECT ls.id, ls.student_id, ls.subject_id, ls.starts_at,
          EXISTS (
            SELECT 1
            FROM student_subject_enrollments e
            JOIN orders o ON o.family_id = (SELECT st.family_id FROM students st WHERE st.id=ls.student_id)
            LEFT JOIN lesson_topups lt ON lt.order_id=o.id AND lt.enrollment_id=e.id
            LEFT JOIN lesson_checkout_intents lci ON lci.order_id=o.id AND lci.enrollment_id=e.id
            WHERE e.student_id=ls.student_id AND e.subject_id=ls.subject_id
              AND (lt.id IS NOT NULL OR lci.id IS NOT NULL)
              AND o.status IN ('PAID','PARTIALLY_REFUNDED')
              AND o.paid_at >= ls.starts_at
              AND o.total_minor > COALESCE((SELECT SUM(p.refunded_minor) FROM payments p WHERE p.order_id=o.id),0)
          ) AS bought
        FROM live_sessions ls
        WHERE ls.actual_teacher_id=${actor.id}
          AND ls.session_type='FIRST' AND ls.status='COMPLETED'
      )
      SELECT COUNT(*)::int AS first_lessons,
        COUNT(*) FILTER (WHERE bought)::int AS purchased
      FROM first_lessons
    `);
    const row = result.rows[0] as { first_lessons: number; purchased: number };
    const firstLessons = Number(row.first_lessons);
    const purchased = Number(row.purchased);
    return { firstLessons, purchased, percentage: firstLessons ? Math.round(purchased * 100 / firstLessons) : null };
  }

  async listMyStudents(
    actor: AuthUser,
    input: { search?: string; status?: "ACTIVE" | "ARCHIVED" | "ALL" },
  ) {
    if (!actor.roles.includes("TEACHER")) {
      throw new ForbiddenException({ code: "TEACHER_STUDENTS_SCOPE_DENIED", message: "Teacher account required" });
    }

    const search = input.search?.trim() ? `%${input.search.trim()}%` : null;
    const status = input.status ?? "ACTIVE";
    const result = await this.db.execute(sql`
      WITH teacher_enrollments AS (
        SELECT DISTINCT ON (e.id)
          e.id AS enrollment_id,
          e.student_id,
          e.status AS enrollment_status,
          e.default_duration_minutes,
          sub.id AS subject_id,
          sub.name AS subject_name,
          ta.started_at AS assignment_started_at,
          ta.ended_at AS assignment_ended_at,
          (ta.ended_at IS NULL AND e.status <> 'INACTIVE') AS is_active_relation
        FROM teacher_assignments ta
        JOIN student_subject_enrollments e ON e.id = ta.enrollment_id
        JOIN subjects sub ON sub.id = e.subject_id
        WHERE ta.teacher_id = ${actor.id}
        ORDER BY e.id, (ta.ended_at IS NULL) DESC, COALESCE(ta.ended_at, 'infinity'::timestamptz) DESC, ta.started_at DESC
      ), balances AS (
        SELECT e.id AS enrollment_id,
          (
            COALESCE((SELECT SUM(g.credits_granted) FROM lesson_credit_grants g WHERE g.enrollment_id = e.id), 0)
            - COALESCE((SELECT SUM(d.credits_debited) FROM lesson_credit_debits d WHERE d.enrollment_id = e.id), 0)
          )::int AS balance_credits
        FROM student_subject_enrollments e
      ), current_schedules AS (
        SELECT v.enrollment_id,
          jsonb_agg(
            jsonb_build_object(
              'dayOfWeek', sl.day_of_week,
              'startTime', to_char(sl.start_time, 'HH24:MI'),
              'durationMinutes', sl.duration_minutes
            ) ORDER BY sl.day_of_week, sl.start_time
          ) AS slots
        FROM regular_schedule_versions v
        JOIN regular_schedule_slots sl ON sl.schedule_version_id = v.id
        WHERE v.effective_from <= (now() AT TIME ZONE 'Europe/Kyiv')::date
          AND (v.effective_until IS NULL OR v.effective_until >= (now() AT TIME ZONE 'Europe/Kyiv')::date)
        GROUP BY v.enrollment_id
      ), last_lessons AS (
        SELECT enrollment_id, MAX(starts_at) AS last_lesson_at
        FROM live_sessions
        WHERE status IN ('COMPLETED', 'CHARGED_NO_SHOW')
        GROUP BY enrollment_id
      )
      SELECT
        st.id,
        st.first_name,
        st.last_name,
        st.grade_level,
        pp.first_name AS parent_first_name,
        pp.last_name AS parent_last_name,
        pp.phone AS parent_phone,
        bool_or(te.is_active_relation) AS active,
        MAX(ll.last_lesson_at) AS last_lesson_at,
        jsonb_agg(
          jsonb_build_object(
            'id', te.enrollment_id,
            'subjectId', te.subject_id,
            'subjectName', te.subject_name,
            'status', te.enrollment_status,
            'defaultDurationMinutes', te.default_duration_minutes,
            'active', te.is_active_relation,
            'balanceCredits', COALESCE(b.balance_credits, 0),
            'balanceLessonUnits', COALESCE(b.balance_credits, 0) / 2.0,
            'schedule', CASE WHEN te.is_active_relation THEN COALESCE(cs.slots, '[]'::jsonb) ELSE '[]'::jsonb END,
            'assignmentStartedAt', te.assignment_started_at,
            'assignmentEndedAt', te.assignment_ended_at
          ) ORDER BY te.subject_name
        ) AS enrollments
      FROM teacher_enrollments te
      JOIN students st ON st.id = te.student_id
      JOIN parent_profiles pp ON pp.family_id = st.family_id
      LEFT JOIN balances b ON b.enrollment_id = te.enrollment_id
      LEFT JOIN current_schedules cs ON cs.enrollment_id = te.enrollment_id
      LEFT JOIN last_lessons ll ON ll.enrollment_id = te.enrollment_id
      WHERE st.archived_at IS NULL
        AND (${search}::text IS NULL OR concat_ws(' ', st.first_name, st.last_name, st.last_name, st.first_name) ILIKE ${search})
        AND (
          ${status}::text = 'ALL'
          OR (${status}::text = 'ACTIVE' AND te.is_active_relation)
          OR (${status}::text = 'ARCHIVED' AND NOT te.is_active_relation)
        )
      GROUP BY st.id, st.first_name, st.last_name, st.grade_level, pp.first_name, pp.last_name, pp.phone
      ORDER BY st.last_name, st.first_name
    `);

    return result.rows;
  }

  async getMyStudent(studentId: string, actor: AuthUser) {
    if (!actor.roles.includes("TEACHER")) {
      throw new ForbiddenException({ code: "TEACHER_STUDENT_SCOPE_DENIED", message: "Teacher account required" });
    }

    const studentResult = await this.db.execute(sql`
      SELECT
        st.id,
        st.first_name,
        st.last_name,
        st.grade_level,
        st.birth_date,
        pp.user_id AS parent_user_id,
        pp.first_name AS parent_first_name,
        pp.last_name AS parent_last_name,
        pp.phone AS parent_phone,
        u.email AS parent_email,
        tg.username AS parent_telegram_username
      FROM students st
      JOIN parent_profiles pp ON pp.family_id = st.family_id
      JOIN users u ON u.id = pp.user_id
      LEFT JOIN telegram_connections tg ON tg.user_id = pp.user_id AND tg.status = 'ACTIVE'
      WHERE st.id = ${studentId}
        AND st.archived_at IS NULL
        AND EXISTS (
          SELECT 1
          FROM student_subject_enrollments e
          WHERE e.student_id = st.id
            AND (
              EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.enrollment_id = e.id AND ta.teacher_id = ${actor.id})
              OR EXISTS (SELECT 1 FROM live_sessions ls WHERE ls.enrollment_id = e.id AND ls.actual_teacher_id = ${actor.id})
            )
        )
      LIMIT 1
    `);
    if (!studentResult.rowCount) {
      throw new NotFoundException({ code: "TEACHER_STUDENT_NOT_FOUND", message: "Student is not assigned to this teacher" });
    }

    const enrollmentResult = await this.db.execute(sql`
      WITH teacher_enrollments AS (
        SELECT
          e.id AS enrollment_id,
          e.status AS enrollment_status,
          e.default_duration_minutes,
          e.started_at AS enrollment_started_at,
          sub.id AS subject_id,
          sub.name AS subject_name,
          own_ta.started_at AS assignment_started_at,
          own_ta.ended_at AS assignment_ended_at,
          (own_ta.id IS NOT NULL AND own_ta.ended_at IS NULL AND e.status <> 'INACTIVE') AS is_active_relation
        FROM student_subject_enrollments e
        JOIN subjects sub ON sub.id = e.subject_id
        LEFT JOIN LATERAL (
          SELECT ta.id, ta.started_at, ta.ended_at
          FROM teacher_assignments ta
          WHERE ta.enrollment_id = e.id AND ta.teacher_id = ${actor.id}
          ORDER BY (ta.ended_at IS NULL) DESC, COALESCE(ta.ended_at, 'infinity'::timestamptz) DESC, ta.started_at DESC
          LIMIT 1
        ) own_ta ON true
        WHERE e.student_id = ${studentId}
          AND (
            own_ta.id IS NOT NULL
            OR EXISTS (SELECT 1 FROM live_sessions ls WHERE ls.enrollment_id = e.id AND ls.actual_teacher_id = ${actor.id})
          )
      ), balances AS (
        SELECT e.id AS enrollment_id,
          (
            COALESCE((SELECT SUM(g.credits_granted) FROM lesson_credit_grants g WHERE g.enrollment_id = e.id), 0)
            - COALESCE((SELECT SUM(d.credits_debited) FROM lesson_credit_debits d WHERE d.enrollment_id = e.id), 0)
          )::int AS balance_credits
        FROM student_subject_enrollments e
      ), current_schedules AS (
        SELECT v.enrollment_id,
          jsonb_agg(
            jsonb_build_object(
              'dayOfWeek', sl.day_of_week,
              'startTime', to_char(sl.start_time, 'HH24:MI'),
              'durationMinutes', sl.duration_minutes
            ) ORDER BY sl.day_of_week, sl.start_time
          ) AS slots
        FROM regular_schedule_versions v
        JOIN regular_schedule_slots sl ON sl.schedule_version_id = v.id
        WHERE v.effective_from <= (now() AT TIME ZONE 'Europe/Kyiv')::date
          AND (v.effective_until IS NULL OR v.effective_until >= (now() AT TIME ZONE 'Europe/Kyiv')::date)
        GROUP BY v.enrollment_id
      )
      SELECT
        te.*,
        COALESCE(b.balance_credits, 0) AS balance_credits,
        CASE WHEN te.is_active_relation THEN COALESCE(cs.slots, '[]'::jsonb) ELSE '[]'::jsonb END AS schedule,
        next_session.id AS next_session_id,
        next_session.starts_at AS next_session_starts_at,
        next_session.ends_at AS next_session_ends_at,
        next_session.actual_teacher_id AS next_session_teacher_id
      FROM teacher_enrollments te
      LEFT JOIN balances b ON b.enrollment_id = te.enrollment_id
      LEFT JOIN current_schedules cs ON cs.enrollment_id = te.enrollment_id
      LEFT JOIN LATERAL (
        SELECT ls.id, ls.starts_at, ls.ends_at, ls.actual_teacher_id
        FROM live_sessions ls
        WHERE ls.enrollment_id = te.enrollment_id
          AND ls.status = 'SCHEDULED'
          AND ls.starts_at > now()
        ORDER BY ls.starts_at
        LIMIT 1
      ) next_session ON true
      ORDER BY te.is_active_relation DESC, te.subject_name
    `);

    const pendingResult = await this.db.execute(sql`
      SELECT
        rr.id,
        rr.subject_id,
        sub.name AS subject_name,
        rr.target_session_id,
        s.starts_at AS target_starts_at,
        s.status AS target_session_status,
        rr.visible_to_student,
        rr.created_at
      FROM progress_report_requests rr
      JOIN subjects sub ON sub.id = rr.subject_id
      LEFT JOIN live_sessions s ON s.id = rr.target_session_id
      LEFT JOIN teacher_assignments current_ta ON current_ta.enrollment_id = rr.enrollment_id AND current_ta.ended_at IS NULL
      WHERE rr.student_id = ${studentId}
        AND rr.status = 'PENDING'
        AND (current_ta.teacher_id = ${actor.id} OR s.actual_teacher_id = ${actor.id})
      ORDER BY COALESCE(s.starts_at, rr.created_at)
    `);

    const student = studentResult.rows[0] as any;
    return {
      id: student.id,
      firstName: student.first_name,
      lastName: student.last_name,
      gradeLevel: student.grade_level,
      birthDate: student.birth_date,
      parent: {
        userId: student.parent_user_id,
        firstName: student.parent_first_name,
        lastName: student.parent_last_name,
        phone: student.parent_phone,
        email: student.parent_email,
        telegramUsername: student.parent_telegram_username,
      },
      enrollments: enrollmentResult.rows.map((row: any) => ({
        id: row.enrollment_id,
        subject: { id: row.subject_id, name: row.subject_name },
        status: row.enrollment_status,
        defaultDurationMinutes: row.default_duration_minutes,
        startedAt: row.enrollment_started_at,
        activeForTeacher: row.is_active_relation,
        assignmentStartedAt: row.assignment_started_at,
        assignmentEndedAt: row.assignment_ended_at,
        balance: {
          credits: Number(row.balance_credits),
          lessonUnits: Number(row.balance_credits) / 2,
        },
        schedule: row.schedule ?? [],
        nextSession: row.next_session_id ? {
          id: row.next_session_id,
          startsAt: row.next_session_starts_at,
          endsAt: row.next_session_ends_at,
          actualTeacherId: row.next_session_teacher_id,
        } : null,
      })),
      pendingReports: pendingResult.rows.map((row: any) => ({
        id: row.id,
        subjectId: row.subject_id,
        subjectName: row.subject_name,
        targetSessionId: row.target_session_id,
        targetStartsAt: row.target_starts_at,
        targetSessionStatus: row.target_session_status,
        visibleToStudent: row.visible_to_student,
        createdAt: row.created_at,
      })),
    };
  }

  async publicList() {
    const teachers = await this.list();
    return teachers
      .filter((teacher) => teacher.teacherStatus === "ACTIVE")
      .map((teacher) => ({
        userId: teacher.userId,
        firstName: teacher.firstName,
        lastName: teacher.lastName,
        subjects: teacher.subjects.filter((subject) => subject.isActive),
      }));
  }

  async getById(teacherId: string) {
    const teachers = await this.list();
    const teacher = teachers.find((item) => item.userId === teacherId);
    if (!teacher) {
      throw new NotFoundException({ code: "TEACHER_NOT_FOUND", message: "Teacher not found" });
    }

    const [summary, invitation, grants] = await Promise.all([
      this.db.execute(sql`
        SELECT
          COUNT(DISTINCT ta.enrollment_id) FILTER (WHERE ta.ended_at IS NULL AND e.status <> 'INACTIVE')::int AS active_students,
          COUNT(DISTINCT ta.enrollment_id) FILTER (WHERE ta.ended_at IS NOT NULL OR e.status = 'INACTIVE')::int AS former_students,
          (SELECT COUNT(*)::int FROM teacher_vacation_requests v WHERE v.teacher_id=${teacherId} AND v.status='PENDING') AS pending_vacations,
          (SELECT COUNT(*)::int FROM live_sessions ls WHERE ls.actual_teacher_id=${teacherId} AND ls.status='SCHEDULED' AND ls.starts_at>now()) AS future_sessions
        FROM teacher_assignments ta
        LEFT JOIN student_subject_enrollments e ON e.id=ta.enrollment_id
        WHERE ta.teacher_id=${teacherId}
      `),
      this.db.execute(sql`
        SELECT created_at,expires_at,accepted_at
        FROM user_invitations
        WHERE user_id=${teacherId}
        ORDER BY created_at DESC
        LIMIT 1
      `),
      this.db.execute(sql`
        SELECT p.code AS permission_code,g.scope_type,g.scope_id,g.starts_at,g.expires_at,g.revoked_at
        FROM temporary_permission_grants g
        JOIN permissions p ON p.id=g.permission_id
        WHERE g.user_id=${teacherId} AND g.revoked_at IS NULL AND g.expires_at>now()
        ORDER BY g.expires_at
      `),
    ]);

    const summaryRow = (summary.rows[0] ?? {}) as any;
    return {
      ...teacher,
      summary: {
        activeStudents: Number(summaryRow.active_students ?? 0),
        formerStudents: Number(summaryRow.former_students ?? 0),
        pendingVacations: Number(summaryRow.pending_vacations ?? 0),
        futureSessions: Number(summaryRow.future_sessions ?? 0),
      },
      latestInvitation: invitation.rows[0] ?? null,
      temporaryPermissions: grants.rows,
    };
  }

  async addSubject(teacherId: string, dto: AddTeacherSubjectDto, actor: AuthUser, requestId?: string) {
    const [teacher] = await this.db
      .select({ id: teacherProfiles.userId, archivedAt: teacherProfiles.archivedAt })
      .from(teacherProfiles)
      .where(eq(teacherProfiles.userId, teacherId))
      .limit(1);
    if (!teacher || teacher.archivedAt) {
      throw new NotFoundException({ code: "TEACHER_NOT_FOUND", message: "Teacher not found" });
    }

    const [subject] = await this.db
      .select({ id: subjects.id, name: subjects.name })
      .from(subjects)
      .where(and(eq(subjects.id, dto.subjectId), eq(subjects.status, "ACTIVE")))
      .limit(1);
    if (!subject) {
      throw new NotFoundException({ code: "SUBJECT_NOT_FOUND", message: "Active subject not found" });
    }

    try {
      return await this.db.transaction(async (tx) => {
        const [link] = await tx
          .insert(teacherSubjects)
          .values({ teacherId, subjectId: dto.subjectId, isActive: true })
          .onConflictDoUpdate({
            target: [teacherSubjects.teacherId, teacherSubjects.subjectId],
            set: { isActive: true },
          })
          .returning();

        await this.audit.record(
          {
            actorUserId: actor.id,
            actorRoleCode: actor.roles[0],
            action: "ASSIGN_TEACHER_SUBJECT",
            entityType: "TeacherSubject",
            entityId: link.id,
            requestId,
            afterData: { teacherId, subjectId: dto.subjectId, subjectName: subject.name, isActive: true },
          },
          tx,
        );

        return link;
      });
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        throw new ConflictException({ code: "TEACHER_SUBJECT_CONFLICT", message: "Teacher subject assignment conflict" });
      }
      throw error;
    }
  }

  async updateProfile(teacherId: string, dto: UpdateTeacherDto, actor: AuthUser, requestId?: string) {
    await this.db.transaction(async (tx) => {
      const beforeResult = await tx.execute(sql`
        SELECT tp.*,u.email,u.status AS user_status
        FROM teacher_profiles tp JOIN users u ON u.id=tp.user_id
        WHERE tp.user_id=${teacherId}
        FOR UPDATE OF tp
      `);
      if (!beforeResult.rowCount) throw new NotFoundException({ code: "TEACHER_NOT_FOUND", message: "Teacher not found" });
      const before = beforeResult.rows[0] as any;
      if (before.archived_at) throw new ConflictException({ code: "TEACHER_ARCHIVED", message: "Reactivate the teacher before editing" });
      const result = await tx.execute(sql`
        UPDATE teacher_profiles SET
          first_name=COALESCE(${dto.firstName?.trim() ?? null},first_name),
          last_name=COALESCE(${dto.lastName?.trim() ?? null},last_name),
          phone=COALESCE(${dto.phone?.trim() ?? null},phone),
          zoom_url=COALESCE(${dto.zoomUrl?.trim() ?? null},zoom_url),
          started_at=COALESCE(${dto.startedAt ?? null}::date,started_at),
          updated_at=now()
        WHERE user_id=${teacherId}
        RETURNING *
      `);
      const after = result.rows[0] as any;
      await this.audit.record({
        actorUserId: actor.id, actorRoleCode: actor.roles[0], action: "UPDATE_TEACHER_PROFILE",
        entityType: "TeacherProfile", entityId: teacherId, requestId,
        beforeData: { firstName: before.first_name, lastName: before.last_name, phone: before.phone, zoomUrl: before.zoom_url, startedAt: before.started_at },
        afterData: { firstName: after.first_name, lastName: after.last_name, phone: after.phone, zoomUrl: after.zoom_url, startedAt: after.started_at },
      }, tx as any);
      return after;
    });
    return this.getById(teacherId);
  }

  async updateMyProfile(dto: UpdateMyTeacherProfileDto, actor: AuthUser, requestId?: string) {
    if (!actor.roles.includes("TEACHER")) throw new ForbiddenException({ code: "TEACHER_ONLY", message: "Teacher account required" });
    return this.updateProfile(actor.id, dto, actor, requestId);
  }

  async setSubjectStatus(teacherId: string, subjectId: string, active: boolean, actor: AuthUser, requestId?: string) {
    return this.db.transaction(async (tx) => {
      const before = await tx.execute(sql`
        SELECT ts.id,ts.is_active,s.name,s.status AS subject_status
        FROM teacher_subjects ts JOIN subjects s ON s.id=ts.subject_id
        WHERE ts.teacher_id=${teacherId} AND ts.subject_id=${subjectId}
        FOR UPDATE OF ts
      `);
      if (!before.rowCount) throw new NotFoundException({ code: "TEACHER_SUBJECT_NOT_FOUND", message: "Teacher subject assignment not found" });
      const row = before.rows[0] as any;
      if (active && row.subject_status !== "ACTIVE") {
        throw new ConflictException({ code: "SUBJECT_ARCHIVED", message: "Restore the subject before activating it for a teacher" });
      }
      if (!active) {
        const activeEnrollment = await tx.execute(sql`
          SELECT 1 FROM teacher_assignments ta
          JOIN student_subject_enrollments e ON e.id=ta.enrollment_id
          WHERE ta.teacher_id=${teacherId} AND ta.ended_at IS NULL AND e.subject_id=${subjectId} AND e.status <> 'INACTIVE'
          LIMIT 1
        `);
        if (activeEnrollment.rowCount) throw new ConflictException({ code: "TEACHER_SUBJECT_IN_USE", message: "Reassign active students before disabling this subject" });
      }
      const result = await tx.execute(sql`UPDATE teacher_subjects SET is_active=${active} WHERE id=${row.id} RETURNING *`);
      await this.audit.record({ actorUserId: actor.id, actorRoleCode: actor.roles[0], action: active ? "ACTIVATE_TEACHER_SUBJECT" : "DEACTIVATE_TEACHER_SUBJECT", entityType: "TeacherSubject", entityId: row.id, requestId, beforeData: { isActive: row.is_active }, afterData: { isActive: active, subjectId, subjectName: row.name } }, tx as any);
      return result.rows[0];
    });
  }

  async archive(teacherId: string, actor: AuthUser, requestId?: string) {
    if (teacherId === actor.id) throw new ConflictException({ code: "CANNOT_ARCHIVE_SELF", message: "You cannot archive your own teacher account" });
    return this.db.transaction(async (tx) => {
      const teacherResult = await tx.execute(sql`SELECT tp.*,u.status AS user_status FROM teacher_profiles tp JOIN users u ON u.id=tp.user_id WHERE tp.user_id=${teacherId} FOR UPDATE OF tp,u`);
      if (!teacherResult.rowCount) throw new NotFoundException({ code: "TEACHER_NOT_FOUND", message: "Teacher not found" });
      const teacher = teacherResult.rows[0] as any;
      if (teacher.user_status === "SUSPENDED") throw new ConflictException({ code: "ACCOUNT_SUSPENDED", message: "Restore the suspended account before archiving the teacher" });
      if (teacher.archived_at) return { ok: true, alreadyArchived: true };
      const dependencies = await tx.execute(sql`
        SELECT
          EXISTS(SELECT 1 FROM teacher_assignments ta JOIN student_subject_enrollments e ON e.id=ta.enrollment_id WHERE ta.teacher_id=${teacherId} AND ta.ended_at IS NULL AND e.status <> 'INACTIVE') AS has_active_students,
          EXISTS(SELECT 1 FROM live_sessions ls WHERE ls.actual_teacher_id=${teacherId} AND ls.status='SCHEDULED' AND ls.starts_at>now()) AS has_future_sessions
      `);
      const dep = dependencies.rows[0] as any;
      if (dep.has_active_students || dep.has_future_sessions) throw new ConflictException({ code: "TEACHER_HAS_ACTIVE_WORK", message: "Reassign active students and future lessons before archiving this teacher", details: dep });
      await tx.execute(sql`UPDATE teacher_profiles SET status='ARCHIVED',archived_at=now(),updated_at=now() WHERE user_id=${teacherId}`);
      await tx.execute(sql`UPDATE users SET status='ARCHIVED',archived_at=now(),updated_at=now() WHERE id=${teacherId}`);
      await tx.execute(sql`UPDATE user_sessions SET revoked_at=now() WHERE user_id=${teacherId} AND revoked_at IS NULL`);
      await this.audit.record({ actorUserId: actor.id, actorRoleCode: actor.roles[0], action: "ARCHIVE_TEACHER", entityType: "TeacherProfile", entityId: teacherId, requestId, beforeData: { teacherStatus: teacher.status, userStatus: teacher.user_status }, afterData: { teacherStatus: "ARCHIVED", userStatus: "ARCHIVED" } }, tx as any);
      return { ok: true };
    });
  }

  async reactivate(teacherId: string, actor: AuthUser, requestId?: string) {
    await this.db.transaction(async (tx) => {
      const current = await tx.execute(sql`SELECT tp.archived_at,u.password_hash,u.status AS user_status FROM teacher_profiles tp JOIN users u ON u.id=tp.user_id WHERE tp.user_id=${teacherId} FOR UPDATE OF tp,u`);
      if (!current.rowCount) throw new NotFoundException({ code: "TEACHER_NOT_FOUND", message: "Teacher not found" });
      const row = current.rows[0] as any;
      if (!row.archived_at) return { unchanged: true };
      if (row.user_status === 'SUSPENDED') throw new ConflictException({ code: "ACCOUNT_SUSPENDED", message: "Restore the suspended account before reactivating the teacher" });
      const userStatus = row.password_hash ? 'ACTIVE' : 'PENDING';
      const teacherStatus = row.password_hash ? 'ACTIVE' : 'INVITED';
      await tx.execute(sql`UPDATE teacher_profiles SET status=${teacherStatus}::teacher_status,archived_at=NULL,updated_at=now() WHERE user_id=${teacherId}`);
      await tx.execute(sql`UPDATE users SET status=${userStatus}::user_status,archived_at=NULL,updated_at=now() WHERE id=${teacherId}`);
      await this.audit.record({ actorUserId: actor.id, actorRoleCode: actor.roles[0], action: "REACTIVATE_TEACHER", entityType: "TeacherProfile", entityId: teacherId, requestId, afterData: { teacherStatus, userStatus } }, tx as any);
      return { ok: true };
    });
    return this.getById(teacherId);
  }

  async history(teacherId: string, limit = 80) {
    const teacher = await this.db.execute(sql`SELECT 1 FROM teacher_profiles WHERE user_id=${teacherId}`);
    if (!teacher.rowCount) throw new NotFoundException({ code: "TEACHER_NOT_FOUND", message: "Teacher not found" });
    const safeLimit = Math.max(1, Math.min(200, Number.isFinite(limit) ? limit : 80));
    const result = await this.db.execute(sql`
      SELECT a.id,a.action,a.entity_type,a.entity_id,a.before_data,a.after_data,a.created_at,a.actor_role_code,
             u.email AS actor_email,
             COALESCE(sp.last_name || ' ' || sp.first_name,tp.last_name || ' ' || tp.first_name,pp.last_name || ' ' || pp.first_name,u.email,'SYSTEM') AS actor_name
      FROM audit_logs a
      LEFT JOIN users u ON u.id=a.actor_user_id
      LEFT JOIN staff_profiles sp ON sp.user_id=a.actor_user_id
      LEFT JOIN teacher_profiles tp ON tp.user_id=a.actor_user_id
      LEFT JOIN parent_profiles pp ON pp.user_id=a.actor_user_id
      WHERE a.entity_id=${teacherId}
         OR a.after_data->>'teacherId'=${teacherId}
         OR a.before_data->>'teacherId'=${teacherId}
      ORDER BY a.created_at DESC
      LIMIT ${safeLimit}
    `);
    return result.rows;
  }

  async createRate(
    teacherId: string,
    subjectId: string,
    dto: CreateTeacherRateDto,
    actor: AuthUser,
    requestId?: string,
  ) {
    const [teacherSubject] = await this.db
      .select({ id: teacherSubjects.id, isActive: teacherSubjects.isActive })
      .from(teacherSubjects)
      .where(and(eq(teacherSubjects.teacherId, teacherId), eq(teacherSubjects.subjectId, subjectId)))
      .limit(1);

    if (!teacherSubject?.isActive) {
      throw new NotFoundException({
        code: "TEACHER_SUBJECT_NOT_FOUND",
        message: "Active teacher subject assignment not found",
      });
    }

    try {
      return await this.db.transaction(async (tx) => {
        const [rate] = await tx
          .insert(teacherRateVersions)
          .values({
            teacherSubjectId: teacherSubject.id,
            rate60Minor: dto.rate60Minor,
            currency: (dto.currency ?? "UAH").toUpperCase(),
            effectiveFrom: dto.effectiveFrom,
            effectiveUntil: dto.effectiveUntil,
            createdBy: actor.id,
          })
          .returning();

        await this.audit.record(
          {
            actorUserId: actor.id,
            actorRoleCode: actor.roles[0],
            action: "CREATE_TEACHER_RATE_VERSION",
            entityType: "TeacherRateVersion",
            entityId: rate.id,
            requestId,
            afterData: {
              teacherId,
              subjectId,
              rate60Minor: rate.rate60Minor,
              currency: rate.currency,
              effectiveFrom: rate.effectiveFrom,
              effectiveUntil: rate.effectiveUntil,
            },
          },
          tx,
        );

        return rate;
      });
    } catch (error) {
      if (isPgExclusionViolation(error)) {
        throw new ConflictException({
          code: "TEACHER_RATE_PERIOD_OVERLAP",
          message: "Teacher rate period overlaps another rate version",
        });
      }
      throw error;
    }
  }

  async listRates(teacherId: string) {
    const rows = await this.db
      .select({
        rateId: teacherRateVersions.id,
        subjectId: subjects.id,
        subjectName: subjects.name,
        rate60Minor: teacherRateVersions.rate60Minor,
        currency: teacherRateVersions.currency,
        effectiveFrom: teacherRateVersions.effectiveFrom,
        effectiveUntil: teacherRateVersions.effectiveUntil,
      })
      .from(teacherSubjects)
      .innerJoin(subjects, eq(teacherSubjects.subjectId, subjects.id))
      .innerJoin(teacherRateVersions, eq(teacherSubjects.id, teacherRateVersions.teacherSubjectId))
      .where(eq(teacherSubjects.teacherId, teacherId))
      .orderBy(asc(subjects.name), asc(teacherRateVersions.effectiveFrom));

    if (!rows.length) {
      const [teacher] = await this.db
        .select({ id: teacherProfiles.userId })
        .from(teacherProfiles)
        .where(eq(teacherProfiles.userId, teacherId))
        .limit(1);
      if (!teacher) throw new NotFoundException({ code: "TEACHER_NOT_FOUND", message: "Teacher not found" });
    }

    return rows;
  }
}
