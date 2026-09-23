import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Database } from "@school/db";
import { sql } from "drizzle-orm";
import { DATABASE } from "../../common/database/database.constants";
import type { AuthUser } from "../auth/types";
import { AuditService } from "../audit/audit.service";
import { OutboxService } from "../audit/outbox.service";
import type {
  CreateAccessPlanDto,
  CreateBlockDto,
  CreateCourseDto,
  CreateCourseLessonDto,
  CreateModuleDto,
  CreateQuestionDto,
  CreateSubjectTopicDto,
  CreateTestDto,
  ManualCoursePurchaseDto,
  RequestTutorFromCourseDto,
  SubmitAnswerDto,
  UpdateAccessPlanDto,
  UpdateBlockDto,
  UpdateCourseDto,
  UpdateCourseLessonDto,
  UpdateModuleDto,
  UpdateTestDto,
} from "./dto/course.dto";

@Injectable()
export class CoursesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private actorRole(actor: AuthUser) {
    return actor.roles[0] ?? "UNKNOWN";
  }

  private async settingNumber(key: string, fallback: number) {
    const result = await this.db.execute(sql`SELECT value FROM school_settings WHERE key=${key}`);
    if (!result.rowCount) return fallback;
    const raw = (result.rows[0] as any).value;
    const value = Number(typeof raw === "object" && raw !== null && "value" in raw ? raw.value : raw);
    return Number.isFinite(value) ? value : fallback;
  }

  async createCourse(dto: CreateCourseDto, actor: AuthUser, requestId?: string) {
    const result = await this.db.execute(sql`
      INSERT INTO courses(subject_id,title,slug,description,cover_asset_id,created_by)
      VALUES(${dto.subjectId ?? null},${dto.title.trim()},${dto.slug.trim()},${dto.description ?? null},${dto.coverAssetId ?? null},${actor.id})
      RETURNING *
    `);
    const course = result.rows[0] as any;
    await this.audit.record({
      actorUserId: actor.id,
      actorRoleCode: this.actorRole(actor),
      action: "CREATE_COURSE",
      entityType: "Course",
      entityId: course.id,
      afterData: course,
      requestId,
    });
    return course;
  }

  async updateCourse(id: string, dto: UpdateCourseDto, actor: AuthUser, requestId?: string) {
    return this.db.transaction(async (tx) => {
      const beforeResult = await tx.execute(sql`SELECT * FROM courses WHERE id=${id} FOR UPDATE`);
      if (!beforeResult.rowCount) throw new NotFoundException({ code: "COURSE_NOT_FOUND", message: "Course not found" });
      const before = beforeResult.rows[0] as any;
      const result = await tx.execute(sql`
        UPDATE courses SET
          title=COALESCE(${dto.title ?? null},title),
          slug=COALESCE(${dto.slug ?? null},slug),
          description=COALESCE(${dto.description ?? null},description),
          subject_id=COALESCE(${dto.subjectId ?? null}::uuid,subject_id),
          cover_asset_id=COALESCE(${dto.coverAssetId ?? null}::uuid,cover_asset_id),
          updated_at=now()
        WHERE id=${id}
        RETURNING *
      `);
      const after = result.rows[0] as any;
      await this.audit.record({
        actorUserId: actor.id,
        actorRoleCode: this.actorRole(actor),
        action: "UPDATE_COURSE",
        entityType: "Course",
        entityId: id,
        beforeData: before,
        afterData: after,
        requestId,
      }, tx as any);
      return after;
    });
  }

  async list(actor?: AuthUser) {
    const canManage = actor?.permissions.includes("course.manage") ?? false;
    const result = await this.db.execute(sql`
      SELECT c.*,s.name subject_name,
        (SELECT COUNT(*)::int FROM course_modules m WHERE m.course_id=c.id) module_count,
        (SELECT COUNT(*)::int FROM course_lessons l JOIN course_modules m ON m.id=l.module_id WHERE m.course_id=c.id) lesson_count,
        (SELECT MIN(price_minor) FROM course_access_plans p WHERE p.course_id=c.id AND p.is_active=true) from_price_minor
      FROM courses c
      LEFT JOIN subjects s ON s.id=c.subject_id
      WHERE (${canManage} OR c.status='PUBLISHED')
      ORDER BY c.created_at DESC
    `);
    return result.rows;
  }

  async detail(id: string, actor?: AuthUser) {
    const canManage = actor?.permissions.includes("course.manage") ?? false;
    const courseResult = await this.db.execute(sql`
      SELECT c.*,s.name subject_name,a.status cover_status,a.storage_key cover_storage_key
      FROM courses c
      LEFT JOIN subjects s ON s.id=c.subject_id
      LEFT JOIN assets a ON a.id=c.cover_asset_id
      WHERE c.id=${id} AND (${canManage} OR c.status='PUBLISHED')
    `);
    if (!courseResult.rowCount) throw new NotFoundException({ code: "COURSE_NOT_FOUND", message: "Course not found" });

    const modules = await this.db.execute(sql`
      SELECT m.*,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id',l.id,
            'title',l.title,
            'description',l.description,
            'position',l.position,
            'estimatedMinutes',l.estimated_minutes,
            'isPublished',l.is_published,
            'blockCount',(SELECT COUNT(*)::int FROM course_lesson_blocks b WHERE b.lesson_id=l.id)
          ) ORDER BY l.position)
          FROM course_lessons l
          WHERE l.module_id=m.id AND (${canManage} OR l.is_published=true)
        ),'[]'::jsonb) lessons
      FROM course_modules m
      WHERE m.course_id=${id}
      ORDER BY m.position
    `);
    const plans = await this.db.execute(sql`
      SELECT * FROM course_access_plans
      WHERE course_id=${id} AND (${canManage} OR is_active=true)
      ORDER BY is_active DESC,price_minor,name
    `);
    return { course: courseResult.rows[0], modules: modules.rows, plans: plans.rows };
  }

  async progressOverview(courseId: string) {
    const totals = await this.db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM course_licenses WHERE course_id=${courseId} AND status='ACTIVE' AND ends_at>now()) active_licenses,
        (SELECT COUNT(*)::int FROM course_enrollments ce JOIN course_licenses l ON l.id=ce.license_id WHERE l.course_id=${courseId} AND l.status='ACTIVE' AND l.ends_at>now()) enrolled_students,
        (SELECT COUNT(*)::int FROM course_lessons cl JOIN course_modules cm ON cm.id=cl.module_id WHERE cm.course_id=${courseId} AND cl.is_published=true) published_lessons
    `);
    const rows = await this.db.execute(sql`
      SELECT ce.id course_enrollment_id,ce.student_id,st.first_name,st.last_name,l.ends_at,
        COUNT(cl.id)::int lesson_count,
        COUNT(p.lesson_id) FILTER (WHERE p.status='COMPLETED')::int completed_count
      FROM course_enrollments ce
      JOIN course_licenses l ON l.id=ce.license_id
      JOIN students st ON st.id=ce.student_id
      LEFT JOIN course_modules cm ON cm.course_id=l.course_id
      LEFT JOIN course_lessons cl ON cl.module_id=cm.id AND cl.is_published=true
      LEFT JOIN course_lesson_progress p ON p.enrollment_id=ce.id AND p.lesson_id=cl.id
      WHERE l.course_id=${courseId} AND l.status='ACTIVE' AND l.ends_at>now()
      GROUP BY ce.id,ce.student_id,st.first_name,st.last_name,l.ends_at
      ORDER BY ce.granted_at DESC
      LIMIT 50
    `);
    const students = (rows.rows as any[]).map((row) => ({ ...row, progressPercent: Number(row.lesson_count) ? Math.round(Number(row.completed_count) / Number(row.lesson_count) * 100) : 0 }));
    const averageProgressPercent = students.length ? Math.round(students.reduce((sum, row) => sum + row.progressPercent, 0) / students.length) : 0;
    return { ...(totals.rows[0] as any), averageProgressPercent, students };
  }

  async addModule(courseId: string, dto: CreateModuleDto, actor: AuthUser, requestId?: string) {
    const result = await this.db.execute(sql`
      INSERT INTO course_modules(course_id,title,description,position)
      VALUES(${courseId},${dto.title},${dto.description ?? null},${dto.position})
      RETURNING *
    `);
    const module = result.rows[0] as any;
    await this.audit.record({ actorUserId: actor.id, actorRoleCode: this.actorRole(actor), action: "CREATE_COURSE_MODULE", entityType: "CourseModule", entityId: module.id, afterData: module, requestId });
    return module;
  }

  async updateModule(id: string, dto: UpdateModuleDto, actor: AuthUser, requestId?: string) {
    const result = await this.db.execute(sql`
      UPDATE course_modules SET
        title=COALESCE(${dto.title ?? null},title),
        description=COALESCE(${dto.description ?? null},description),
        updated_at=now()
      WHERE id=${id}
      RETURNING *
    `);
    if (!result.rowCount) throw new NotFoundException({ code: "COURSE_MODULE_NOT_FOUND", message: "Module not found" });
    await this.audit.record({ actorUserId: actor.id, actorRoleCode: this.actorRole(actor), action: "UPDATE_COURSE_MODULE", entityType: "CourseModule", entityId: id, afterData: result.rows[0], requestId });
    return result.rows[0];
  }

  async addLesson(moduleId: string, dto: CreateCourseLessonDto, actor: AuthUser, requestId?: string) {
    const result = await this.db.execute(sql`
      INSERT INTO course_lessons(module_id,title,description,position,estimated_minutes)
      VALUES(${moduleId},${dto.title},${dto.description ?? null},${dto.position},${dto.estimatedMinutes ?? null})
      RETURNING *
    `);
    const lesson = result.rows[0] as any;
    await this.audit.record({ actorUserId: actor.id, actorRoleCode: this.actorRole(actor), action: "CREATE_COURSE_LESSON", entityType: "CourseLesson", entityId: lesson.id, afterData: lesson, requestId });
    return lesson;
  }

  async updateLesson(id: string, dto: UpdateCourseLessonDto, actor: AuthUser, requestId?: string) {
    const result = await this.db.execute(sql`
      UPDATE course_lessons SET
        title=COALESCE(${dto.title ?? null},title),
        description=COALESCE(${dto.description ?? null},description),
        estimated_minutes=COALESCE(${dto.estimatedMinutes ?? null},estimated_minutes),
        updated_at=now()
      WHERE id=${id}
      RETURNING *
    `);
    if (!result.rowCount) throw new NotFoundException({ code: "COURSE_LESSON_NOT_FOUND", message: "Lesson not found" });
    await this.audit.record({ actorUserId: actor.id, actorRoleCode: this.actorRole(actor), action: "UPDATE_COURSE_LESSON", entityType: "CourseLesson", entityId: id, afterData: result.rows[0], requestId });
    return result.rows[0];
  }

  private async validateBlockShape(dto: CreateBlockDto | UpdateBlockDto, existing?: any) {
    const type = (dto as CreateBlockDto).type ?? existing?.type;
    const content = dto.content ?? existing?.content;
    const assetId = dto.assetId ?? existing?.asset_id;
    const testId = dto.testId ?? existing?.test_id;
    if (type === "TEXT" && !content) throw new BadRequestException({ code: "TEXT_CONTENT_REQUIRED", message: "Text block requires content" });
    if (type === "PDF") {
      if (!assetId) throw new BadRequestException({ code: "PDF_ASSET_REQUIRED", message: "PDF block requires an uploaded PDF" });
      const asset = await this.db.execute(sql`SELECT id,type,mime_type FROM assets WHERE id=${assetId}`);
      if (!asset.rowCount || !["PDF", "application/pdf"].includes(String((asset.rows[0] as any).type === "PDF" ? "PDF" : (asset.rows[0] as any).mime_type))) {
        throw new BadRequestException({ code: "PDF_ASSET_INVALID", message: "Selected asset is not a PDF" });
      }
    }
    if (type === "TEST" && !testId) throw new BadRequestException({ code: "TEST_REQUIRED", message: "Test block requires a test" });
  }

  async addBlock(lessonId: string, dto: CreateBlockDto, actor: AuthUser, requestId?: string) {
    await this.validateBlockShape(dto);
    const result = await this.db.execute(sql`
      INSERT INTO course_lesson_blocks(lesson_id,type,position,content,asset_id,test_id)
      VALUES(
        ${lessonId},${dto.type},${dto.position},
        ${dto.type === "TEXT" ? JSON.stringify(dto.content) : null}::jsonb,
        ${dto.type === "PDF" ? dto.assetId ?? null : null},
        ${dto.type === "TEST" ? dto.testId ?? null : null}
      )
      RETURNING *
    `);
    const block = result.rows[0] as any;
    await this.audit.record({ actorUserId: actor.id, actorRoleCode: this.actorRole(actor), action: "CREATE_COURSE_BLOCK", entityType: "CourseLessonBlock", entityId: block.id, afterData: block, requestId });
    return block;
  }

  async updateBlock(id: string, dto: UpdateBlockDto, actor: AuthUser, requestId?: string) {
    const beforeResult = await this.db.execute(sql`SELECT * FROM course_lesson_blocks WHERE id=${id}`);
    if (!beforeResult.rowCount) throw new NotFoundException({ code: "COURSE_BLOCK_NOT_FOUND", message: "Block not found" });
    const before = beforeResult.rows[0] as any;
    await this.validateBlockShape(dto, before);
    const result = await this.db.execute(sql`
      UPDATE course_lesson_blocks SET
        content=CASE WHEN type='TEXT' THEN COALESCE(${dto.content ? JSON.stringify(dto.content) : null}::jsonb,content) ELSE NULL END,
        asset_id=CASE WHEN type='PDF' THEN COALESCE(${dto.assetId ?? null}::uuid,asset_id) ELSE NULL END,
        test_id=CASE WHEN type='TEST' THEN COALESCE(${dto.testId ?? null}::uuid,test_id) ELSE NULL END,
        updated_at=now()
      WHERE id=${id}
      RETURNING *
    `);
    const after = result.rows[0] as any;
    await this.audit.record({ actorUserId: actor.id, actorRoleCode: this.actorRole(actor), action: "UPDATE_COURSE_BLOCK", entityType: "CourseLessonBlock", entityId: id, beforeData: before, afterData: after, requestId });
    return after;
  }

  async deleteBlock(id: string, actor: AuthUser, requestId?: string) {
    const result = await this.db.execute(sql`DELETE FROM course_lesson_blocks WHERE id=${id} RETURNING *`);
    if (!result.rowCount) throw new NotFoundException({ code: "COURSE_BLOCK_NOT_FOUND", message: "Block not found" });
    await this.audit.record({ actorUserId: actor.id, actorRoleCode: this.actorRole(actor), action: "DELETE_COURSE_BLOCK", entityType: "CourseLessonBlock", entityId: id, beforeData: result.rows[0], requestId });
    return { deleted: true };
  }

  private async reorder(table: "course_modules" | "course_lessons" | "course_lesson_blocks", groupColumn: "course_id" | "module_id" | "lesson_id", groupId: string, ids: string[]) {
    if (!ids.length) throw new BadRequestException({ code: "ORDER_EMPTY", message: "Order cannot be empty" });
    return this.db.transaction(async (tx) => {
      const current = await tx.execute(sql.raw(`SELECT id FROM ${table} WHERE ${groupColumn}='${groupId.replace(/'/g, "''")}' ORDER BY position`));
      const currentIds = current.rows.map((row: any) => row.id as string);
      if (currentIds.length !== ids.length || new Set(ids).size !== ids.length || currentIds.some((id) => !ids.includes(id))) {
        throw new BadRequestException({ code: "ORDER_SCOPE_MISMATCH", message: "Order must contain every item exactly once" });
      }
      await tx.execute(sql.raw(`UPDATE ${table} SET position=position+100000 WHERE ${groupColumn}='${groupId.replace(/'/g, "''")}'`));
      for (let index = 0; index < ids.length; index += 1) {
        await tx.execute(sql.raw(`UPDATE ${table} SET position=${index + 1}${table !== "course_lessons" ? ", updated_at=now()" : ", updated_at=now()"} WHERE id='${ids[index]!.replace(/'/g, "''")}'`));
      }
      return { ids };
    });
  }

  async reorderModules(courseId: string, ids: string[], actor: AuthUser, requestId?: string) {
    const result = await this.reorder("course_modules", "course_id", courseId, ids);
    await this.audit.record({ actorUserId: actor.id, actorRoleCode: this.actorRole(actor), action: "REORDER_COURSE_MODULES", entityType: "Course", entityId: courseId, afterData: result, requestId });
    return result;
  }

  async reorderLessons(moduleId: string, ids: string[], actor: AuthUser, requestId?: string) {
    const result = await this.reorder("course_lessons", "module_id", moduleId, ids);
    await this.audit.record({ actorUserId: actor.id, actorRoleCode: this.actorRole(actor), action: "REORDER_COURSE_LESSONS", entityType: "CourseModule", entityId: moduleId, afterData: result, requestId });
    return result;
  }

  async reorderBlocks(lessonId: string, ids: string[], actor: AuthUser, requestId?: string) {
    const result = await this.reorder("course_lesson_blocks", "lesson_id", lessonId, ids);
    await this.audit.record({ actorUserId: actor.id, actorRoleCode: this.actorRole(actor), action: "REORDER_COURSE_BLOCKS", entityType: "CourseLesson", entityId: lessonId, afterData: result, requestId });
    return result;
  }

  async lessonBuilder(lessonId: string) {
    const lessonResult = await this.db.execute(sql`
      SELECT l.*,m.course_id,m.title module_title,c.title course_title,c.subject_id
      FROM course_lessons l
      JOIN course_modules m ON m.id=l.module_id
      JOIN courses c ON c.id=m.course_id
      WHERE l.id=${lessonId}
    `);
    if (!lessonResult.rowCount) throw new NotFoundException({ code: "COURSE_LESSON_NOT_FOUND", message: "Lesson not found" });
    const blocks = await this.db.execute(sql`
      SELECT b.*,a.status asset_status,a.original_filename,a.mime_type,a.processing_error,
        COALESCE((SELECT COUNT(*)::int FROM pdf_processed_pages p WHERE p.source_asset_id=b.asset_id),0) pdf_page_count,
        t.title test_title,t.type test_type,
        COALESCE((SELECT COUNT(*)::int FROM test_questions tq WHERE tq.test_id=b.test_id),0) test_question_count
      FROM course_lesson_blocks b
      LEFT JOIN assets a ON a.id=b.asset_id
      LEFT JOIN tests t ON t.id=b.test_id
      WHERE b.lesson_id=${lessonId}
      ORDER BY b.position
    `);
    return { lesson: lessonResult.rows[0], blocks: blocks.rows };
  }

  async addPlan(courseId: string, dto: CreateAccessPlanDto, actor: AuthUser, requestId?: string) {
    if (dto.accessType === "DURATION" && !dto.durationMonths) throw new BadRequestException({ code: "DURATION_REQUIRED", message: "durationMonths is required" });
    if (dto.accessType === "FIXED_EXPIRY" && !dto.fixedExpiryDate) throw new BadRequestException({ code: "EXPIRY_REQUIRED", message: "fixedExpiryDate is required" });
    const result = await this.db.execute(sql`
      INSERT INTO course_access_plans(course_id,name,access_type,duration_months,fixed_expiry_date,price_minor,explanations_enabled)
      VALUES(${courseId},${dto.name},${dto.accessType},${dto.durationMonths ?? null},${dto.fixedExpiryDate ?? null},${dto.priceMinor},${dto.explanationsEnabled ?? false})
      RETURNING *
    `);
    const plan = result.rows[0] as any;
    await this.audit.record({ actorUserId: actor.id, actorRoleCode: this.actorRole(actor), action: "CREATE_COURSE_ACCESS_PLAN", entityType: "CourseAccessPlan", entityId: plan.id, afterData: plan, requestId });
    return plan;
  }

  async updatePlan(id: string, dto: UpdateAccessPlanDto, actor: AuthUser, requestId?: string) {
    const result = await this.db.execute(sql`
      UPDATE course_access_plans SET
        name=COALESCE(${dto.name ?? null},name),
        price_minor=COALESCE(${dto.priceMinor ?? null},price_minor),
        explanations_enabled=COALESCE(${dto.explanationsEnabled ?? null},explanations_enabled),
        is_active=COALESCE(${dto.isActive ?? null},is_active),
        updated_at=now()
      WHERE id=${id}
      RETURNING *
    `);
    if (!result.rowCount) throw new NotFoundException({ code: "COURSE_PLAN_NOT_FOUND", message: "Course plan not found" });
    await this.audit.record({ actorUserId: actor.id, actorRoleCode: this.actorRole(actor), action: "UPDATE_COURSE_ACCESS_PLAN", entityType: "CourseAccessPlan", entityId: id, afterData: result.rows[0], requestId });
    return result.rows[0];
  }

  async publish(courseId: string, actor: AuthUser, requestId?: string) {
    const validation = await this.db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM course_modules WHERE course_id=${courseId})::int modules,
        (SELECT COUNT(*) FROM course_lessons l JOIN course_modules m ON m.id=l.module_id WHERE m.course_id=${courseId} AND l.is_published=true)::int published_lessons,
        (SELECT COUNT(*) FROM course_access_plans WHERE course_id=${courseId} AND is_active=true)::int plans
    `);
    const counts = validation.rows[0] as any;
    if (!counts || Number(counts.modules) === 0 || Number(counts.published_lessons) === 0 || Number(counts.plans) === 0) {
      throw new BadRequestException({ code: "COURSE_NOT_READY", message: "Publish at least one lesson and create an active access plan before publishing the course" });
    }
    const result = await this.db.execute(sql`
      UPDATE courses SET status='PUBLISHED',published_at=COALESCE(published_at,now()),archived_at=NULL,updated_at=now()
      WHERE id=${courseId}
      RETURNING *
    `);
    if (!result.rowCount) throw new NotFoundException({ code: "COURSE_NOT_FOUND", message: "Course not found" });
    await this.audit.record({ actorUserId: actor.id, actorRoleCode: this.actorRole(actor), action: "PUBLISH_COURSE", entityType: "Course", entityId: courseId, afterData: result.rows[0], requestId });
    return result.rows[0];
  }

  async archive(courseId: string, actor: AuthUser, requestId?: string) {
    const result = await this.db.execute(sql`UPDATE courses SET status='ARCHIVED',archived_at=now(),updated_at=now() WHERE id=${courseId} RETURNING *`);
    if (!result.rowCount) throw new NotFoundException({ code: "COURSE_NOT_FOUND", message: "Course not found" });
    await this.audit.record({ actorUserId: actor.id, actorRoleCode: this.actorRole(actor), action: "ARCHIVE_COURSE", entityType: "Course", entityId: courseId, afterData: result.rows[0], requestId });
    return result.rows[0];
  }

  async publishLesson(lessonId: string, actor: AuthUser, requestId?: string) {
    const blockCount = await this.db.execute(sql`SELECT COUNT(*)::int count FROM course_lesson_blocks WHERE lesson_id=${lessonId}`);
    if (Number((blockCount.rows[0] as any)?.count ?? 0) === 0) throw new BadRequestException({ code: "LESSON_EMPTY", message: "Add at least one content block before publishing the lesson" });
    const result = await this.db.execute(sql`UPDATE course_lessons SET is_published=true,updated_at=now() WHERE id=${lessonId} RETURNING *`);
    if (!result.rowCount) throw new NotFoundException({ code: "COURSE_LESSON_NOT_FOUND", message: "Lesson not found" });
    await this.audit.record({ actorUserId: actor.id, actorRoleCode: this.actorRole(actor), action: "PUBLISH_COURSE_LESSON", entityType: "CourseLesson", entityId: lessonId, afterData: result.rows[0], requestId });
    return result.rows[0];
  }

  async unpublishLesson(lessonId: string, actor: AuthUser, requestId?: string) {
    const result = await this.db.execute(sql`UPDATE course_lessons SET is_published=false,updated_at=now() WHERE id=${lessonId} RETURNING *`);
    if (!result.rowCount) throw new NotFoundException({ code: "COURSE_LESSON_NOT_FOUND", message: "Lesson not found" });
    await this.audit.record({ actorUserId: actor.id, actorRoleCode: this.actorRole(actor), action: "UNPUBLISH_COURSE_LESSON", entityType: "CourseLesson", entityId: lessonId, afterData: result.rows[0], requestId });
    return result.rows[0];
  }

  async listTopics(subjectId?: string) {
    const result = await this.db.execute(sql`
      SELECT t.*,p.name parent_name,s.name subject_name
      FROM subject_topics t
      JOIN subjects s ON s.id=t.subject_id
      LEFT JOIN subject_topics p ON p.id=t.parent_topic_id
      WHERE (${subjectId ?? null}::uuid IS NULL OR t.subject_id=${subjectId ?? null}::uuid)
      ORDER BY s.name,COALESCE(p.name,''),t.name
    `);
    return result.rows;
  }

  async createTopic(dto: CreateSubjectTopicDto, actor: AuthUser, requestId?: string) {
    const result = await this.db.execute(sql`
      INSERT INTO subject_topics(subject_id,parent_topic_id,name,code)
      VALUES(${dto.subjectId},${dto.parentTopicId ?? null},${dto.name},${dto.code ?? null})
      RETURNING *
    `);
    const topic = result.rows[0] as any;
    await this.audit.record({ actorUserId: actor.id, actorRoleCode: this.actorRole(actor), action: "CREATE_SUBJECT_TOPIC", entityType: "SubjectTopic", entityId: topic.id, afterData: topic, requestId });
    return topic;
  }

  async createTest(dto: CreateTestDto, actor: AuthUser, requestId?: string) {
    const defaultThreshold = await this.settingNumber("course_low_score_threshold_percent", 40);
    if (dto.type === "KNOWLEDGE_CHECK" && !dto.timeLimitSeconds) {
      throw new BadRequestException({ code: "TIME_LIMIT_REQUIRED", message: "Knowledge check requires a time limit" });
    }
    const result = await this.db.execute(sql`
      INSERT INTO tests(title,type,time_limit_seconds,low_score_threshold_percent,created_by)
      VALUES(${dto.title},${dto.type},${dto.timeLimitSeconds ?? null},${dto.lowScoreThresholdPercent ?? defaultThreshold},${actor.id})
      RETURNING *
    `);
    const test = result.rows[0] as any;
    await this.audit.record({ actorUserId: actor.id, actorRoleCode: this.actorRole(actor), action: "CREATE_COURSE_TEST", entityType: "CourseTest", entityId: test.id, afterData: test, requestId });
    return test;
  }

  async updateTest(id: string, dto: UpdateTestDto, actor: AuthUser, requestId?: string) {
    const result = await this.db.execute(sql`
      UPDATE tests SET
        title=COALESCE(${dto.title ?? null},title),
        time_limit_seconds=COALESCE(${dto.timeLimitSeconds ?? null},time_limit_seconds),
        low_score_threshold_percent=COALESCE(${dto.lowScoreThresholdPercent ?? null},low_score_threshold_percent),
        updated_at=now()
      WHERE id=${id}
      RETURNING *
    `);
    if (!result.rowCount) throw new NotFoundException({ code: "TEST_NOT_FOUND", message: "Test not found" });
    await this.audit.record({ actorUserId: actor.id, actorRoleCode: this.actorRole(actor), action: "UPDATE_COURSE_TEST", entityType: "CourseTest", entityId: id, afterData: result.rows[0], requestId });
    return result.rows[0];
  }

  async testDetail(id: string) {
    const test = await this.db.execute(sql`SELECT * FROM tests WHERE id=${id}`);
    if (!test.rowCount) throw new NotFoundException({ code: "TEST_NOT_FOUND", message: "Test not found" });
    const questions = await this.db.execute(sql`
      SELECT tq.id test_question_id,tq.position,tq.points,qt.*,topic.name topic_name
      FROM test_questions tq
      JOIN question_templates qt ON qt.id=tq.question_template_id
      LEFT JOIN subject_topics topic ON topic.id=qt.topic_id
      WHERE tq.test_id=${id}
      ORDER BY tq.position
    `);
    return { test: test.rows[0], questions: questions.rows };
  }

  async addQuestion(testId: string, dto: CreateQuestionDto, actor: AuthUser, requestId?: string) {
    if (dto.type === "GENERATED" && !dto.generatorDefinition) throw new BadRequestException({ code: "GENERATOR_REQUIRED", message: "Generated question requires generatorDefinition" });
    return this.db.transaction(async (tx) => {
      const question = await tx.execute(sql`
        INSERT INTO question_templates(type,topic_id,prompt_template,answer_definition,generator_definition,explanation_content,created_by)
        VALUES(
          ${dto.type},${dto.topicId ?? null},${JSON.stringify(dto.promptTemplate)}::jsonb,${JSON.stringify(dto.answerDefinition)}::jsonb,
          ${dto.generatorDefinition ? JSON.stringify(dto.generatorDefinition) : null}::jsonb,
          ${dto.explanationContent ? JSON.stringify(dto.explanationContent) : null}::jsonb,
          ${actor.id}
        )
        RETURNING *
      `);
      const template = question.rows[0] as any;
      const testQuestion = await tx.execute(sql`
        INSERT INTO test_questions(test_id,question_template_id,position,points)
        VALUES(${testId},${template.id},${dto.position},${dto.points ?? 1})
        RETURNING *
      `);
      await this.audit.record({ actorUserId: actor.id, actorRoleCode: this.actorRole(actor), action: "CREATE_TEST_QUESTION", entityType: "QuestionTemplate", entityId: template.id, afterData: { template, testId }, requestId }, tx as any);
      return { template, testQuestion: testQuestion.rows[0] };
    });
  }

  private async familyForActor(actor: AuthUser, familyId?: string) {
    if (actor.roles.includes("PARENT")) {
      const result = await this.db.execute(sql`SELECT family_id FROM parent_profiles WHERE user_id=${actor.id}`);
      if (!result.rowCount) throw new ForbiddenException();
      return (result.rows[0] as any).family_id as string;
    }
    if (!familyId) throw new BadRequestException({ code: "FAMILY_REQUIRED", message: "familyId is required for staff purchase" });
    return familyId;
  }

  async manualPurchase(planId: string, dto: ManualCoursePurchaseDto, actor: AuthUser, requestId?: string) {
    const familyId = await this.familyForActor(actor, dto.familyId);
    return this.db.transaction(async (tx) => {
      const planResult = await tx.execute(sql`
        SELECT p.*,c.title course_title,c.status course_status
        FROM course_access_plans p
        JOIN courses c ON c.id=p.course_id
        WHERE p.id=${planId} AND p.is_active=true
        FOR SHARE
      `);
      if (!planResult.rowCount) throw new NotFoundException({ code: "COURSE_PLAN_NOT_FOUND", message: "Course plan not found" });
      const plan = planResult.rows[0] as any;
      if (actor.roles.includes("PARENT") && plan.course_status !== "PUBLISHED") throw new ForbiddenException({ code: "COURSE_NOT_PUBLISHED", message: "Course is not available for purchase" });
      if (actor.roles.includes("PARENT") && dto.amountMinor !== Number(plan.price_minor)) {
        throw new BadRequestException({ code: "PARENT_PRICE_OVERRIDE_DENIED", message: "Parent purchase must use the current plan price" });
      }
      if (!actor.roles.includes("PARENT") && dto.amountMinor > Number(plan.price_minor)) {
        throw new BadRequestException({ code: "AMOUNT_EXCEEDS_PRICE", message: "Amount exceeds plan price" });
      }

      const familyStudents = await tx.execute(sql`SELECT id,user_id FROM students WHERE family_id=${familyId} AND archived_at IS NULL ORDER BY created_at`);
      let studentIds = [...new Set(dto.studentIds)];
      if (!studentIds.length && familyStudents.rowCount === 1) studentIds = [(familyStudents.rows[0] as any).id];
      if (!studentIds.length) throw new BadRequestException({ code: "COURSE_STUDENT_REQUIRED", message: "Select at least one child for course access" });
      const students = (familyStudents.rows as any[]).filter((student) => studentIds.includes(student.id));
      if (students.length !== studentIds.length) throw new BadRequestException({ code: "STUDENT_FAMILY_MISMATCH", message: "All selected students must belong to the family" });

      const orderResult = await tx.execute(sql`
        INSERT INTO orders(family_id,source,status,currency,subtotal_minor,discount_minor,total_minor,created_by,paid_at)
        VALUES(${familyId},${actor.roles.includes("PARENT") ? "ONLINE" : "MANAGER"},'PAID',${plan.currency},${plan.price_minor},${Number(plan.price_minor) - dto.amountMinor},${dto.amountMinor},${actor.id},now())
        RETURNING *
      `);
      const order = orderResult.rows[0] as any;
      await tx.execute(sql`
        INSERT INTO payments(order_id,amount_minor,currency,method,status,recorded_by,paid_at)
        VALUES(${order.id},${dto.amountMinor},${plan.currency},${dto.paymentMethod},'SUCCEEDED',${actor.id},now())
      `);
      const purchaseResult = await tx.execute(sql`
        INSERT INTO course_purchases(order_id,access_plan_id,course_id,base_price_minor,final_price_minor,access_type_snapshot,duration_months_snapshot,fixed_expiry_snapshot,explanations_enabled_snapshot)
        VALUES(${order.id},${planId},${plan.course_id},${plan.price_minor},${dto.amountMinor},${plan.access_type},${plan.duration_months},${plan.fixed_expiry_date},${plan.explanations_enabled})
        RETURNING *
      `);
      const purchase = purchaseResult.rows[0] as any;
      const startsAt = new Date();
      let endsAt: Date;
      if (plan.access_type === "DURATION") {
        endsAt = new Date(startsAt);
        endsAt.setMonth(endsAt.getMonth() + Number(plan.duration_months));
      } else {
        endsAt = new Date(`${plan.fixed_expiry_date}T23:59:59+03:00`);
      }
      const licenseResult = await tx.execute(sql`
        INSERT INTO course_licenses(family_id,course_id,purchase_id,starts_at,ends_at,explanations_enabled)
        VALUES(${familyId},${plan.course_id},${purchase.id},${startsAt},${endsAt},${plan.explanations_enabled})
        RETURNING *
      `);
      const license = licenseResult.rows[0] as any;

      for (const student of students) {
        await tx.execute(sql`
          INSERT INTO course_enrollments(license_id,student_id,granted_by)
          VALUES(${license.id},${student.id},${actor.id})
          ON CONFLICT DO NOTHING
        `);
        if (student.user_id) {
          await this.outbox.publishNotification({
            aggregateType: "CourseLicense",
            aggregateId: license.id,
            recipientUserIds: [student.user_id],
            eventType: "COURSE_ACCESS_GRANTED",
            title: "Відкрито доступ до курсу",
            body: `${plan.course_title}. Доступ до ${endsAt.toLocaleDateString("uk-UA")}.`,
            actionPath: "/student/courses",
            entityType: "CourseLicense",
            entityId: license.id,
          }, tx as any);
        }
      }
      const parent = await tx.execute(sql`SELECT user_id FROM parent_profiles WHERE family_id=${familyId}`);
      if (parent.rowCount) {
        await this.outbox.publishNotification({
          aggregateType: "CourseLicense",
          aggregateId: license.id,
          recipientUserIds: [(parent.rows[0] as any).user_id],
          eventType: "COURSE_ACCESS_GRANTED",
          title: "Курс доступний",
          body: `${plan.course_title}. Доступ до ${endsAt.toLocaleDateString("uk-UA")}.`,
          actionPath: "/parent/courses",
          entityType: "CourseLicense",
          entityId: license.id,
        }, tx as any);
      }
      await this.audit.record({
        actorUserId: actor.id,
        actorRoleCode: this.actorRole(actor),
        action: "PURCHASE_COURSE",
        entityType: "CourseLicense",
        entityId: license.id,
        afterData: { courseId: plan.course_id, studentIds, amountMinor: dto.amountMinor, endsAt },
        requestId,
      }, tx as any);
      return { order, purchase, license };
    });
  }

  async grantStudent(licenseId: string, studentId: string, actor: AuthUser, requestId?: string) {
    return this.db.transaction(async (tx) => {
      const licenseResult = await tx.execute(sql`
        SELECT l.*,s.family_id student_family,s.user_id student_user_id,c.title course_title
        FROM course_licenses l
        JOIN courses c ON c.id=l.course_id
        JOIN students s ON s.id=${studentId}
        WHERE l.id=${licenseId}
      `);
      if (!licenseResult.rowCount) throw new NotFoundException({ code: "COURSE_LICENSE_NOT_FOUND", message: "Course license not found" });
      const license = licenseResult.rows[0] as any;
      const actorFamily = await this.familyForActor(actor, actor.roles.includes("PARENT") ? undefined : license.family_id);
      if (actorFamily !== license.family_id || license.family_id !== license.student_family) {
        throw new ForbiddenException({ code: "COURSE_LICENSE_SCOPE_DENIED", message: "Student and license must belong to your family" });
      }
      if (license.status !== "ACTIVE" || new Date(license.ends_at) <= new Date()) {
        throw new ConflictException({ code: "COURSE_LICENSE_INACTIVE", message: "Cannot grant access from an inactive license" });
      }
      const result = await tx.execute(sql`
        INSERT INTO course_enrollments(license_id,student_id,granted_by)
        VALUES(${licenseId},${studentId},${actor.id})
        ON CONFLICT(license_id,student_id) DO UPDATE SET granted_at=course_enrollments.granted_at
        RETURNING *
      `);
      if (license.student_user_id) {
        await this.outbox.publishNotification({
          aggregateType: "CourseLicense",
          aggregateId: licenseId,
          recipientUserIds: [license.student_user_id],
          eventType: "COURSE_ACCESS_GRANTED",
          title: "Відкрито доступ до курсу",
          body: `${license.course_title}. Доступ до ${new Date(license.ends_at).toLocaleDateString("uk-UA")}.`,
          actionPath: "/student/courses",
          entityType: "CourseLicense",
          entityId: licenseId,
        }, tx as any);
      }
      await this.audit.record({ actorUserId: actor.id, actorRoleCode: this.actorRole(actor), action: "GRANT_COURSE_TO_STUDENT", entityType: "CourseEnrollment", entityId: (result.rows[0] as any).id, afterData: { licenseId, studentId }, requestId }, tx as any);
      return result.rows[0];
    });
  }

  async licenseDetail(licenseId: string, actor: AuthUser) {
    const familyId = await this.familyForActor(actor, actor.roles.includes("PARENT") ? undefined : (await this.db.execute(sql`SELECT family_id FROM course_licenses WHERE id=${licenseId}`)).rows[0]?.family_id as string | undefined);
    const licenseResult = await this.db.execute(sql`
      SELECT l.*,c.title course_title,c.description
      FROM course_licenses l JOIN courses c ON c.id=l.course_id
      WHERE l.id=${licenseId} AND l.family_id=${familyId}
    `);
    if (!licenseResult.rowCount) throw new NotFoundException({ code: "COURSE_LICENSE_NOT_FOUND", message: "Course license not found" });
    const students = await this.db.execute(sql`
      SELECT s.id,s.first_name,s.last_name,s.user_id,ce.id course_enrollment_id,ce.granted_at
      FROM students s
      LEFT JOIN course_enrollments ce ON ce.student_id=s.id AND ce.license_id=${licenseId}
      WHERE s.family_id=${familyId} AND s.archived_at IS NULL
      ORDER BY s.created_at
    `);
    return { license: licenseResult.rows[0], students: students.rows };
  }

  private async accessibleStudentIds(actor: AuthUser) {
    if (actor.roles.includes("STUDENT")) {
      const result = await this.db.execute(sql`SELECT id FROM students WHERE user_id=${actor.id}`);
      return result.rows.map((row: any) => row.id as string);
    }
    if (actor.roles.includes("PARENT")) {
      const result = await this.db.execute(sql`SELECT s.id FROM students s JOIN parent_profiles p ON p.family_id=s.family_id WHERE p.user_id=${actor.id}`);
      return result.rows.map((row: any) => row.id as string);
    }
    return null;
  }

  async myCourses(actor: AuthUser) {
    const ids = await this.accessibleStudentIds(actor);
    if (ids === null) throw new ForbiddenException({ code: "PORTAL_ONLY", message: "Use a student or parent account" });
    if (!ids.length) return [];
    const result = await this.db.execute(sql`
      SELECT ce.id course_enrollment_id,ce.student_id,ce.license_id,st.first_name,st.last_name,
        c.id course_id,c.title,c.description,l.ends_at,l.explanations_enabled,l.status,
        (SELECT COUNT(*)::int FROM course_lessons cl JOIN course_modules cm ON cm.id=cl.module_id WHERE cm.course_id=c.id AND cl.is_published=true) lesson_count,
        (SELECT COUNT(*)::int FROM course_lesson_progress p WHERE p.enrollment_id=ce.id AND p.status='COMPLETED') completed_count
      FROM course_enrollments ce
      JOIN course_licenses l ON l.id=ce.license_id
      JOIN courses c ON c.id=l.course_id
      JOIN students st ON st.id=ce.student_id
      WHERE ce.student_id=ANY(${ids}::uuid[]) AND l.status='ACTIVE' AND l.ends_at>now()
      ORDER BY c.title,st.first_name
    `);
    return result.rows;
  }

  private async assertCourseEnrollment(id: string, actor: AuthUser) {
    const ids = await this.accessibleStudentIds(actor);
    const result = await this.db.execute(sql`
      SELECT ce.*,l.course_id,l.ends_at,l.status license_status,l.explanations_enabled,
        st.first_name student_first_name,st.last_name student_last_name
      FROM course_enrollments ce
      JOIN course_licenses l ON l.id=ce.license_id
      JOIN students st ON st.id=ce.student_id
      WHERE ce.id=${id}
    `);
    if (!result.rowCount) throw new NotFoundException({ code: "COURSE_ENROLLMENT_NOT_FOUND", message: "Course access not found" });
    const enrollment = result.rows[0] as any;
    if (ids !== null && !ids.includes(enrollment.student_id)) throw new ForbiddenException();
    if (enrollment.license_status !== "ACTIVE" || new Date(enrollment.ends_at) < new Date()) {
      throw new ForbiddenException({ code: "COURSE_ACCESS_EXPIRED", message: "Course access has expired" });
    }
    return enrollment;
  }

  async enrollmentContent(id: string, actor: AuthUser) {
    const enrollment = await this.assertCourseEnrollment(id, actor);
    const result = await this.db.execute(sql`
      SELECT m.id module_id,m.title module_title,m.position module_position,
        l.id lesson_id,l.title lesson_title,l.description,l.position lesson_position,l.estimated_minutes,
        COALESCE(p.status,'NOT_STARTED'::course_lesson_progress_status) progress_status,p.completed_at
      FROM course_modules m
      JOIN course_lessons l ON l.module_id=m.id
      LEFT JOIN course_lesson_progress p ON p.lesson_id=l.id AND p.enrollment_id=${id}
      WHERE m.course_id=${enrollment.course_id} AND l.is_published=true
      ORDER BY m.position,l.position
    `);
    return { enrollment, items: result.rows };
  }

  async lessonContent(enrollmentId: string, lessonId: string, actor: AuthUser) {
    const enrollment = await this.assertCourseEnrollment(enrollmentId, actor);
    const lesson = await this.db.execute(sql`
      SELECT l.*,m.course_id
      FROM course_lessons l
      JOIN course_modules m ON m.id=l.module_id
      WHERE l.id=${lessonId} AND m.course_id=${enrollment.course_id} AND l.is_published=true
    `);
    if (!lesson.rowCount) throw new NotFoundException({ code: "COURSE_LESSON_NOT_FOUND", message: "Lesson not found" });
    await this.db.execute(sql`
      INSERT INTO course_lesson_progress(enrollment_id,lesson_id,status,first_started_at,last_opened_at)
      VALUES(${enrollmentId},${lessonId},'IN_PROGRESS',now(),now())
      ON CONFLICT(enrollment_id,lesson_id) DO UPDATE SET
        status=CASE WHEN course_lesson_progress.status='NOT_STARTED' THEN 'IN_PROGRESS'::course_lesson_progress_status ELSE course_lesson_progress.status END,
        last_opened_at=now(),
        first_started_at=COALESCE(course_lesson_progress.first_started_at,now())
    `);
    const blocks = await this.db.execute(sql`
      SELECT b.id,b.type,b.position,b.content,b.asset_id,b.test_id,a.status asset_status,a.mime_type,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object('assetId',p.page_asset_id,'pageNumber',p.page_number) ORDER BY p.page_number)
          FROM pdf_processed_pages p WHERE p.source_asset_id=b.asset_id
        ),'[]'::jsonb) pdf_pages
      FROM course_lesson_blocks b
      LEFT JOIN assets a ON a.id=b.asset_id
      WHERE b.lesson_id=${lessonId}
      ORDER BY b.position
    `);
    return { lesson: lesson.rows[0], blocks: blocks.rows };
  }

  async completeLesson(enrollmentId: string, lessonId: string, actor: AuthUser) {
    await this.assertCourseEnrollment(enrollmentId, actor);
    const result = await this.db.execute(sql`
      INSERT INTO course_lesson_progress(enrollment_id,lesson_id,status,first_started_at,completed_at,last_opened_at)
      VALUES(${enrollmentId},${lessonId},'COMPLETED',now(),now(),now())
      ON CONFLICT(enrollment_id,lesson_id) DO UPDATE SET
        status='COMPLETED',completed_at=COALESCE(course_lesson_progress.completed_at,now()),last_opened_at=now()
      RETURNING *
    `);
    return result.rows[0];
  }

  private generated(template: any) {
    const generator = template.generator_definition ?? {};
    const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
    if (generator.kind === "LINEAR_EQUATION") {
      let a = randomInt(generator.aMin ?? 1, generator.aMax ?? 9);
      if (a === 0) a = 1;
      const x = randomInt(generator.xMin ?? -10, generator.xMax ?? 10);
      const b = randomInt(generator.bMin ?? -20, generator.bMax ?? 20);
      const c = a * x + b;
      return { prompt: { text: `${a}x ${b < 0 ? "-" : "+"} ${Math.abs(b)} = ${c}` }, answer: { type: "NUMBER", correct: x } };
    }
    if (generator.kind === "ARITHMETIC") {
      const a = randomInt(generator.min ?? 1, generator.max ?? 100);
      const b = randomInt(generator.min ?? 1, generator.max ?? 100);
      const operation = generator.operation ?? "ADD";
      return {
        prompt: { text: operation === "SUB" ? `${a + b} − ${b}` : `${a} + ${b}` },
        answer: { type: "NUMBER", correct: operation === "SUB" ? a : a + b },
      };
    }
    return { prompt: template.prompt_template, answer: template.answer_definition };
  }

  async startTest(courseEnrollmentId: string, testId: string, actor: AuthUser) {
    const enrollment = await this.assertCourseEnrollment(courseEnrollmentId, actor);
    const testResult = await this.db.execute(sql`SELECT * FROM tests WHERE id=${testId}`);
    if (!testResult.rowCount) throw new NotFoundException({ code: "TEST_NOT_FOUND", message: "Test not found" });
    const belongs = await this.db.execute(sql`
      SELECT 1
      FROM course_lesson_blocks b
      JOIN course_lessons l ON l.id=b.lesson_id
      JOIN course_modules m ON m.id=l.module_id
      WHERE b.test_id=${testId} AND m.course_id=${enrollment.course_id} AND l.is_published=true
      LIMIT 1
    `);
    if (!belongs.rowCount) throw new ForbiddenException({ code: "TEST_COURSE_MISMATCH", message: "Test does not belong to this course" });
    const test = testResult.rows[0] as any;
    const attemptResult = await this.db.execute(sql`
      INSERT INTO test_attempts(student_id,test_id,course_enrollment_id)
      VALUES(${enrollment.student_id},${testId},${courseEnrollmentId})
      RETURNING *
    `);
    const attempt = attemptResult.rows[0] as any;
    const questions = await this.db.execute(sql`
      SELECT tq.id test_question_id,tq.position,tq.points,qt.*
      FROM test_questions tq
      JOIN question_templates qt ON qt.id=tq.question_template_id
      WHERE tq.test_id=${testId}
      ORDER BY tq.position
    `);
    const display: any[] = [];
    for (const question of questions.rows as any[]) {
      const generated = question.type === "GENERATED" ? this.generated(question) : { prompt: question.prompt_template, answer: question.answer_definition };
      const inserted = await this.db.execute(sql`
        INSERT INTO test_attempt_questions(attempt_id,test_question_id,generated_prompt,generated_answer_definition,position)
        VALUES(${attempt.id},${question.test_question_id},${JSON.stringify(generated.prompt)}::jsonb,${JSON.stringify(generated.answer)}::jsonb,${question.position})
        RETURNING id
      `);
      display.push({ id: (inserted.rows[0] as any).id, position: question.position, prompt: generated.prompt, points: question.points });
    }
    return { attempt: { ...attempt, timeLimitSeconds: test.time_limit_seconds, type: test.type }, questions: display };
  }

  private checkAnswer(definition: any, answer: any) {
    if (definition?.type === "NUMBER") {
      const actual = Number(answer);
      return Number.isFinite(actual) && Math.abs(actual - Number(definition.correct)) < 1e-9;
    }
    if (definition?.type === "MULTI") {
      const actual = Array.isArray(answer) ? answer.map(String).sort() : [];
      const correct = (definition.correct ?? []).map(String).sort();
      return JSON.stringify(actual) === JSON.stringify(correct);
    }
    return String(answer ?? "").trim().toLocaleLowerCase("uk-UA") === String(definition?.correct ?? "").trim().toLocaleLowerCase("uk-UA");
  }

  private ensureAttemptTime(attempt: any, timeLimitSeconds: number | null | undefined) {
    if (!timeLimitSeconds) return;
    const deadline = new Date(attempt.started_at).getTime() + Number(timeLimitSeconds) * 1000;
    if (Date.now() > deadline) throw new ConflictException({ code: "TEST_TIME_EXPIRED", message: "Time for this test attempt has expired" });
  }

  async answer(attemptId: string, questionId: string, dto: SubmitAnswerDto, actor: AuthUser) {
    const ids = await this.accessibleStudentIds(actor);
    const result = await this.db.execute(sql`
      SELECT aq.*,ta.student_id,ta.status attempt_status,ta.started_at,t.time_limit_seconds,
        tq.points,tq.question_template_id,template.topic_id
      FROM test_attempt_questions aq
      JOIN test_attempts ta ON ta.id=aq.attempt_id
      JOIN tests t ON t.id=ta.test_id
      JOIN test_questions tq ON tq.id=aq.test_question_id
      JOIN question_templates template ON template.id=tq.question_template_id
      WHERE aq.id=${questionId} AND aq.attempt_id=${attemptId}
    `);
    if (!result.rowCount) throw new NotFoundException({ code: "TEST_QUESTION_NOT_FOUND", message: "Question not found" });
    const row = result.rows[0] as any;
    if (ids !== null && !ids.includes(row.student_id)) throw new ForbiddenException();
    if (row.attempt_status !== "IN_PROGRESS") throw new ConflictException({ code: "ATTEMPT_NOT_ACTIVE", message: "Attempt is not active" });
    try {
      this.ensureAttemptTime(row, row.time_limit_seconds);
    } catch (error) {
      await this.db.execute(sql`UPDATE test_attempts SET status='EXPIRED',completed_at=now() WHERE id=${attemptId} AND status='IN_PROGRESS'`);
      throw error;
    }
    const correct = this.checkAnswer(row.generated_answer_definition, dto.answer);
    await this.db.execute(sql`
      UPDATE test_attempt_questions SET
        student_answer=${JSON.stringify(dto.answer)}::jsonb,
        is_correct=${correct},
        points_awarded=${correct ? row.points : 0},
        answered_at=now()
      WHERE id=${questionId}
    `);
    return { questionId, isCorrect: correct };
  }

  async completeAttempt(attemptId: string, actor: AuthUser) {
    const ids = await this.accessibleStudentIds(actor);
    return this.db.transaction(async (tx) => {
      const attemptResult = await tx.execute(sql`
        SELECT ta.*,t.low_score_threshold_percent,t.time_limit_seconds,ce.license_id,l.explanations_enabled
        FROM test_attempts ta
        JOIN tests t ON t.id=ta.test_id
        LEFT JOIN course_enrollments ce ON ce.id=ta.course_enrollment_id
        LEFT JOIN course_licenses l ON l.id=ce.license_id
        WHERE ta.id=${attemptId}
        FOR UPDATE OF ta
      `);
      if (!attemptResult.rowCount) throw new NotFoundException({ code: "TEST_ATTEMPT_NOT_FOUND", message: "Attempt not found" });
      const attempt = attemptResult.rows[0] as any;
      if (ids !== null && !ids.includes(attempt.student_id)) throw new ForbiddenException();
      if (attempt.status !== "IN_PROGRESS") throw new ConflictException({ code: "ATTEMPT_NOT_ACTIVE", message: "Attempt is not active" });
      try {
        this.ensureAttemptTime(attempt, attempt.time_limit_seconds);
      } catch (error) {
        await tx.execute(sql`UPDATE test_attempts SET status='EXPIRED',completed_at=now() WHERE id=${attemptId}`);
        throw error;
      }
      const questions = await tx.execute(sql`
        SELECT aq.*,tq.points,qt.id template_id,qt.topic_id,qt.explanation_content,topic.name topic_name
        FROM test_attempt_questions aq
        JOIN test_questions tq ON tq.id=aq.test_question_id
        JOIN question_templates qt ON qt.id=tq.question_template_id
        LEFT JOIN subject_topics topic ON topic.id=qt.topic_id
        WHERE aq.attempt_id=${attemptId}
        ORDER BY aq.position
      `);
      const total = (questions.rows as any[]).reduce((sum, item) => sum + Number(item.points), 0);
      const score = (questions.rows as any[]).reduce((sum, item) => sum + Number(item.points_awarded ?? 0), 0);
      const percentage = total ? Math.round((score / total) * 10000) / 100 : 0;
      await tx.execute(sql`UPDATE test_attempts SET status='COMPLETED',completed_at=now(),score=${score},max_score=${total},percentage=${percentage} WHERE id=${attemptId}`);
      for (const item of questions.rows as any[]) {
        if (item.is_correct === false || item.is_correct === null) {
          await tx.execute(sql`
            INSERT INTO student_mistakes(student_id,question_template_id,topic_id,first_wrong_attempt_question_id,last_wrong_at)
            VALUES(${attempt.student_id},${item.template_id},${item.topic_id},${item.id},now())
            ON CONFLICT(student_id,question_template_id) DO UPDATE SET
              status='ACTIVE',wrong_count=student_mistakes.wrong_count+1,last_wrong_at=now(),corrected_at=NULL
          `);
        } else {
          await tx.execute(sql`
            UPDATE student_mistakes SET status='CORRECTED',corrected_at=now()
            WHERE student_id=${attempt.student_id} AND question_template_id=${item.template_id} AND status='ACTIVE'
          `);
        }
      }
      const weakTopics = Array.from(new Map(
        (questions.rows as any[])
          .filter((item) => item.is_correct !== true && item.topic_id)
          .map((item) => [item.topic_id, { id: item.topic_id, name: item.topic_name ?? "Тема" }]),
      ).values());
      return {
        attemptId,
        courseEnrollmentId: attempt.course_enrollment_id,
        score,
        maxScore: total,
        percentage,
        lowScore: percentage < Number(attempt.low_score_threshold_percent ?? 40),
        weakTopics,
        questions: (questions.rows as any[]).map((item) => ({
          id: item.id,
          isCorrect: item.is_correct === true,
          pointsAwarded: item.points_awarded ?? 0,
          topicId: item.topic_id,
          topicName: item.topic_name,
          explanation: attempt.explanations_enabled ? item.explanation_content : undefined,
          explanationLocked: !attempt.explanations_enabled,
        })),
      };
    });
  }

  async mistakes(actor: AuthUser, studentId?: string, courseEnrollmentId?: string) {
    const ids = await this.accessibleStudentIds(actor);
    let id = studentId ?? ids?.[0];
    let courseId: string | null = null;
    if (courseEnrollmentId) {
      const enrollment = await this.assertCourseEnrollment(courseEnrollmentId, actor);
      id = enrollment.student_id;
      courseId = enrollment.course_id;
    }
    if (!id) throw new BadRequestException({ code: "STUDENT_REQUIRED", message: "Student required" });
    if (ids !== null && !ids.includes(id)) throw new ForbiddenException();
    const result = await this.db.execute(sql`
      SELECT m.*,t.name topic_name,qt.prompt_template,qt.type question_type,qt.generator_definition,
        first_wrong.generated_prompt first_wrong_prompt,
        (SELECT COUNT(*)::int FROM mistake_practice_attempts pa WHERE pa.mistake_id=m.id) practice_attempt_count,
        (SELECT COUNT(*)::int FROM mistake_practice_attempts pa WHERE pa.mistake_id=m.id AND pa.is_correct=true) practice_correct_count,
        (SELECT MAX(pa.answered_at) FROM mistake_practice_attempts pa WHERE pa.mistake_id=m.id) last_practiced_at
      FROM student_mistakes m
      LEFT JOIN subject_topics t ON t.id=m.topic_id
      JOIN question_templates qt ON qt.id=m.question_template_id
      LEFT JOIN test_attempt_questions first_wrong ON first_wrong.id=m.first_wrong_attempt_question_id
      WHERE m.student_id=${id}
        AND (${courseId}::uuid IS NULL OR EXISTS (
          SELECT 1
          FROM test_questions tq
          JOIN tests test ON test.id=tq.test_id
          JOIN course_lesson_blocks b ON b.test_id=test.id
          JOIN course_lessons l ON l.id=b.lesson_id
          JOIN course_modules cm ON cm.id=l.module_id
          WHERE tq.question_template_id=m.question_template_id AND cm.course_id=${courseId}::uuid
        ))
      ORDER BY (m.status='ACTIVE') DESC,m.last_wrong_at DESC
    `);
    return result.rows;
  }

  async progressSummary(courseEnrollmentId: string, actor: AuthUser) {
    const enrollment = await this.assertCourseEnrollment(courseEnrollmentId, actor);
    const summary = await this.db.execute(sql`
      SELECT ce.id course_enrollment_id,ce.student_id,ce.granted_at,
        st.first_name,st.last_name,st.grade_level,
        c.id course_id,c.title course_title,c.subject_id,
        l.starts_at,l.ends_at,l.explanations_enabled,
        COUNT(DISTINCT cl.id)::int lesson_count,
        COUNT(DISTINCT p.lesson_id) FILTER (WHERE p.status='COMPLETED')::int completed_count,
        MAX(GREATEST(COALESCE(p.last_opened_at,'epoch'::timestamptz),COALESCE(ta.completed_at,'epoch'::timestamptz))) last_activity_at
      FROM course_enrollments ce
      JOIN course_licenses l ON l.id=ce.license_id
      JOIN courses c ON c.id=l.course_id
      JOIN students st ON st.id=ce.student_id
      LEFT JOIN course_modules cm ON cm.course_id=c.id
      LEFT JOIN course_lessons cl ON cl.module_id=cm.id AND cl.is_published=true
      LEFT JOIN course_lesson_progress p ON p.enrollment_id=ce.id AND p.lesson_id=cl.id
      LEFT JOIN test_attempts ta ON ta.course_enrollment_id=ce.id
      WHERE ce.id=${courseEnrollmentId}
      GROUP BY ce.id,ce.student_id,ce.granted_at,st.first_name,st.last_name,st.grade_level,c.id,c.title,c.subject_id,l.starts_at,l.ends_at,l.explanations_enabled
    `);
    if (!summary.rowCount) throw new NotFoundException({ code: "COURSE_ENROLLMENT_NOT_FOUND", message: "Course access not found" });
    const row = summary.rows[0] as any;
    const tests = await this.db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status='COMPLETED')::int completed_attempts,
        ROUND(AVG(percentage) FILTER (WHERE status='COMPLETED'),2) average_percentage,
        MAX(percentage) FILTER (WHERE status='COMPLETED') best_percentage,
        COUNT(*) FILTER (WHERE status='COMPLETED' AND percentage < COALESCE(t.low_score_threshold_percent,40))::int low_score_attempts
      FROM test_attempts ta
      JOIN tests t ON t.id=ta.test_id
      WHERE ta.course_enrollment_id=${courseEnrollmentId}
    `);
    const mistakes = await this.db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE m.status='ACTIVE')::int active_mistakes,
        COUNT(*) FILTER (WHERE m.status='CORRECTED')::int corrected_mistakes
      FROM student_mistakes m
      WHERE m.student_id=${enrollment.student_id}
        AND EXISTS (
          SELECT 1 FROM test_questions tq
          JOIN course_lesson_blocks b ON b.test_id=tq.test_id
          JOIN course_lessons cl ON cl.id=b.lesson_id
          JOIN course_modules cm ON cm.id=cl.module_id
          WHERE tq.question_template_id=m.question_template_id AND cm.course_id=${enrollment.course_id}
        )
    `);
    const lessonCount = Number(row.lesson_count ?? 0);
    const completedCount = Number(row.completed_count ?? 0);
    return {
      ...row,
      progressPercent: lessonCount ? Math.round(completedCount / lessonCount * 100) : 0,
      tests: tests.rows[0] ?? {},
      mistakes: mistakes.rows[0] ?? {},
    };
  }

  async testHistory(courseEnrollmentId: string, actor: AuthUser) {
    await this.assertCourseEnrollment(courseEnrollmentId, actor);
    const result = await this.db.execute(sql`
      SELECT ta.id,ta.status,ta.started_at,ta.completed_at,ta.score,ta.max_score,ta.percentage,
        t.title test_title,t.type test_type,t.low_score_threshold_percent,
        COUNT(aq.id)::int question_count,
        COUNT(aq.id) FILTER (WHERE aq.is_correct=true)::int correct_count
      FROM test_attempts ta
      JOIN tests t ON t.id=ta.test_id
      LEFT JOIN test_attempt_questions aq ON aq.attempt_id=ta.id
      WHERE ta.course_enrollment_id=${courseEnrollmentId}
      GROUP BY ta.id,t.id
      ORDER BY ta.started_at DESC
      LIMIT 100
    `);
    return result.rows;
  }

  async attemptResult(attemptId: string, actor: AuthUser) {
    const ids = await this.accessibleStudentIds(actor);
    const attemptResult = await this.db.execute(sql`
      SELECT ta.*,t.title test_title,t.type test_type,t.low_score_threshold_percent,
        ce.id course_enrollment_id,l.explanations_enabled,c.title course_title
      FROM test_attempts ta
      JOIN tests t ON t.id=ta.test_id
      LEFT JOIN course_enrollments ce ON ce.id=ta.course_enrollment_id
      LEFT JOIN course_licenses l ON l.id=ce.license_id
      LEFT JOIN courses c ON c.id=l.course_id
      WHERE ta.id=${attemptId}
    `);
    if (!attemptResult.rowCount) throw new NotFoundException({ code: "TEST_ATTEMPT_NOT_FOUND", message: "Test attempt not found" });
    const attempt = attemptResult.rows[0] as any;
    if (ids !== null && !ids.includes(attempt.student_id)) throw new ForbiddenException();
    const questions = await this.db.execute(sql`
      SELECT aq.id,aq.position,aq.generated_prompt,aq.student_answer,aq.is_correct,aq.points_awarded,
        tq.points,qt.explanation_content,topic.id topic_id,topic.name topic_name
      FROM test_attempt_questions aq
      JOIN test_questions tq ON tq.id=aq.test_question_id
      JOIN question_templates qt ON qt.id=tq.question_template_id
      LEFT JOIN subject_topics topic ON topic.id=qt.topic_id
      WHERE aq.attempt_id=${attemptId}
      ORDER BY aq.position
    `);
    return {
      attempt,
      lowScore: attempt.status === "COMPLETED" && Number(attempt.percentage ?? 0) < Number(attempt.low_score_threshold_percent ?? 40),
      questions: (questions.rows as any[]).map((item) => ({
        ...item,
        explanation: attempt.explanations_enabled ? item.explanation_content : undefined,
        explanationLocked: !attempt.explanations_enabled,
      })),
    };
  }

  private async assertMistake(mistakeId: string, actor: AuthUser) {
    const ids = await this.accessibleStudentIds(actor);
    const result = await this.db.execute(sql`
      SELECT m.*,qt.type question_type,qt.prompt_template,qt.answer_definition,qt.generator_definition,qt.explanation_content,
        topic.name topic_name
      FROM student_mistakes m
      JOIN question_templates qt ON qt.id=m.question_template_id
      LEFT JOIN subject_topics topic ON topic.id=m.topic_id
      WHERE m.id=${mistakeId}
    `);
    if (!result.rowCount) throw new NotFoundException({ code: "MISTAKE_NOT_FOUND", message: "Mistake not found" });
    const mistake = result.rows[0] as any;
    if (ids !== null && !ids.includes(mistake.student_id)) throw new ForbiddenException();
    return mistake;
  }

  async startMistakePractice(mistakeId: string, courseEnrollmentId: string | undefined, actor: AuthUser) {
    const mistake = await this.assertMistake(mistakeId, actor);
    let enrollment: any = null;
    if (courseEnrollmentId) {
      enrollment = await this.assertCourseEnrollment(courseEnrollmentId, actor);
      if (enrollment.student_id !== mistake.student_id) throw new ForbiddenException({ code: "MISTAKE_STUDENT_MISMATCH", message: "Mistake belongs to another student" });
    }
    const template = {
      prompt_template: mistake.prompt_template,
      answer_definition: mistake.answer_definition,
      generator_definition: mistake.generator_definition,
    };
    const analogous = mistake.question_type === "GENERATED" && Boolean(mistake.generator_definition);
    const generated = analogous ? this.generated(template) : { prompt: mistake.prompt_template, answer: mistake.answer_definition };
    const inserted = await this.db.execute(sql`
      INSERT INTO mistake_practice_attempts(
        mistake_id,student_id,course_enrollment_id,question_template_id,generated_prompt,generated_answer_definition,analogous
      ) VALUES(
        ${mistakeId},${mistake.student_id},${courseEnrollmentId ?? null},${mistake.question_template_id},
        ${JSON.stringify(generated.prompt)}::jsonb,${JSON.stringify(generated.answer)}::jsonb,${analogous}
      )
      RETURNING id,started_at,generated_prompt,analogous
    `);
    return { attempt: inserted.rows[0], topicName: mistake.topic_name, status: mistake.status };
  }

  async answerMistakePractice(attemptId: string, dto: SubmitAnswerDto, actor: AuthUser) {
    const ids = await this.accessibleStudentIds(actor);
    return this.db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        SELECT pa.*,m.status mistake_status,qt.explanation_content,l.explanations_enabled
        FROM mistake_practice_attempts pa
        JOIN student_mistakes m ON m.id=pa.mistake_id
        JOIN question_templates qt ON qt.id=pa.question_template_id
        LEFT JOIN course_enrollments ce ON ce.id=pa.course_enrollment_id
        LEFT JOIN course_licenses l ON l.id=ce.license_id
        WHERE pa.id=${attemptId}
        FOR UPDATE OF pa
      `);
      if (!result.rowCount) throw new NotFoundException({ code: "MISTAKE_PRACTICE_NOT_FOUND", message: "Practice attempt not found" });
      const practice = result.rows[0] as any;
      if (ids !== null && !ids.includes(practice.student_id)) throw new ForbiddenException();
      if (practice.answered_at) throw new ConflictException({ code: "MISTAKE_PRACTICE_ALREADY_ANSWERED", message: "Practice attempt is already answered" });
      const correct = this.checkAnswer(practice.generated_answer_definition, dto.answer);
      await tx.execute(sql`
        UPDATE mistake_practice_attempts SET student_answer=${JSON.stringify(dto.answer)}::jsonb,is_correct=${correct},answered_at=now()
        WHERE id=${attemptId}
      `);
      if (correct) {
        await tx.execute(sql`
          UPDATE student_mistakes SET status='CORRECTED',corrected_at=now()
          WHERE id=${practice.mistake_id}
        `);
      } else {
        await tx.execute(sql`
          UPDATE student_mistakes SET status='ACTIVE',corrected_at=NULL
          WHERE id=${practice.mistake_id}
        `);
      }
      return {
        attemptId,
        isCorrect: correct,
        mistakeStatus: correct ? "CORRECTED" : "ACTIVE",
        explanation: practice.explanations_enabled ? practice.explanation_content : undefined,
        explanationLocked: !practice.explanations_enabled,
      };
    });
  }

  async requestTutorFromCourse(courseEnrollmentId: string, dto: RequestTutorFromCourseDto, actor: AuthUser, requestId?: string) {
    const enrollment = await this.assertCourseEnrollment(courseEnrollmentId, actor);
    return this.db.transaction(async (tx) => {
      const contextResult = await tx.execute(sql`
        SELECT ce.student_id,st.family_id,st.first_name student_first_name,st.last_name student_last_name,st.grade_level,
          c.id course_id,c.title course_title,c.subject_id,
          p.user_id parent_user_id,p.first_name parent_first_name,p.last_name parent_last_name,p.phone,
          u.email parent_email,
          sma.manager_user_id primary_manager_id
        FROM course_enrollments ce
        JOIN course_licenses l ON l.id=ce.license_id
        JOIN courses c ON c.id=l.course_id
        JOIN students st ON st.id=ce.student_id
        JOIN parent_profiles p ON p.family_id=st.family_id
        JOIN users u ON u.id=p.user_id
        LEFT JOIN LATERAL (
          SELECT manager_user_id FROM student_manager_assignments
          WHERE student_id=st.id AND ended_at IS NULL
          ORDER BY started_at DESC LIMIT 1
        ) sma ON true
        WHERE ce.id=${courseEnrollmentId}
      `);
      if (!contextResult.rowCount) throw new NotFoundException({ code: "COURSE_ENROLLMENT_NOT_FOUND", message: "Course access not found" });
      const context = contextResult.rows[0] as any;
      let attempt: any = null;
      if (dto.attemptId) {
        const attemptResult = await tx.execute(sql`
          SELECT ta.id,ta.status,ta.percentage,t.low_score_threshold_percent
          FROM test_attempts ta JOIN tests t ON t.id=ta.test_id
          WHERE ta.id=${dto.attemptId} AND ta.course_enrollment_id=${courseEnrollmentId}
        `);
        if (!attemptResult.rowCount) throw new BadRequestException({ code: "TEST_ATTEMPT_COURSE_MISMATCH", message: "Test attempt does not belong to this course access" });
        attempt = attemptResult.rows[0] as any;
        if (attempt.status !== "COMPLETED" || Number(attempt.percentage ?? 0) >= Number(attempt.low_score_threshold_percent ?? 40)) {
          throw new ConflictException({ code: "TUTOR_REQUEST_NOT_RECOMMENDED", message: "Tutor request from a test is available after a low result" });
        }
      }
      if (dto.topicId) {
        const topic = await tx.execute(sql`
          SELECT 1 FROM subject_topics WHERE id=${dto.topicId} AND (${context.subject_id}::uuid IS NULL OR subject_id=${context.subject_id})
        `);
        if (!topic.rowCount) throw new BadRequestException({ code: "COURSE_TOPIC_MISMATCH", message: "Topic does not belong to this course subject" });
      }
      const existing = await tx.execute(sql`
        SELECT * FROM leads
        WHERE source='COURSE'
          AND source_course_enrollment_id=${courseEnrollmentId}
          AND COALESCE(source_topic_id,'00000000-0000-0000-0000-000000000000'::uuid)=COALESCE(${dto.topicId ?? null}::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
          AND status IN ('NEW','CONTACTED','FIRST_LESSON')
        ORDER BY created_at DESC LIMIT 1
      `);
      if (existing.rowCount) return { lead: existing.rows[0], alreadyExists: true };
      const topicNameResult = dto.topicId ? await tx.execute(sql`SELECT name FROM subject_topics WHERE id=${dto.topicId}`) : null;
      const topicName = topicNameResult?.rowCount ? (topicNameResult.rows[0] as any).name : null;
      const learningGoal = [
        `Запит на репетитора з курсу «${context.course_title}».`,
        attempt ? `Результат тесту: ${Number(attempt.percentage)}%.` : null,
        topicName ? `Тема: ${topicName}.` : null,
        dto.note?.trim() ? dto.note.trim() : null,
      ].filter(Boolean).join(" ");
      const inserted = await tx.execute(sql`
        INSERT INTO leads(
          source,status,parent_first_name,parent_last_name,student_first_name,student_last_name,phone,email,
          subject_id,grade_level,learning_goal,primary_manager_id,created_by,
          source_course_id,source_course_enrollment_id,source_test_attempt_id,source_topic_id
        ) VALUES(
          'COURSE','NEW',${context.parent_first_name},${context.parent_last_name},${context.student_first_name},${context.student_last_name},
          ${context.phone},${context.parent_email},${context.subject_id},${context.grade_level},${learningGoal},${context.primary_manager_id},${actor.id},
          ${context.course_id},${courseEnrollmentId},${dto.attemptId ?? null},${dto.topicId ?? null}
        )
        ON CONFLICT DO NOTHING
        RETURNING *
      `);
      if (!inserted.rowCount) {
        const concurrent = await tx.execute(sql`
          SELECT * FROM leads
          WHERE source='COURSE' AND source_course_enrollment_id=${courseEnrollmentId}
            AND COALESCE(source_topic_id,'00000000-0000-0000-0000-000000000000'::uuid)=COALESCE(${dto.topicId ?? null}::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
            AND status IN ('NEW','CONTACTED','FIRST_LESSON')
          ORDER BY created_at DESC LIMIT 1
        `);
        if (concurrent.rowCount) return { lead: concurrent.rows[0], alreadyExists: true };
        throw new ConflictException({ code: "COURSE_TUTOR_LEAD_CONFLICT", message: "Could not create tutor request" });
      }
      const lead = inserted.rows[0] as any;
      await this.audit.record({
        actorUserId: actor.id,
        actorRoleCode: this.actorRole(actor),
        action: "CREATE_COURSE_TUTOR_LEAD",
        entityType: "Lead",
        entityId: lead.id,
        afterData: { courseEnrollmentId, attemptId: dto.attemptId ?? null, topicId: dto.topicId ?? null },
        requestId,
      }, tx as any);
      return { lead, alreadyExists: false };
    });
  }
}
