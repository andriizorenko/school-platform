import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Database } from "@school/db";
import { sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { DATABASE } from "../../common/database/database.constants";
import { numberSchoolSetting } from "../../common/settings/school-settings";
import type { AuthUser } from "../auth/types";
import { AuditService } from "../audit/audit.service";
import { OutboxService } from "../audit/outbox.service";

@Injectable()
export class FilesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private root() {
    return resolve(this.config.get<string>("STORAGE_DIR") || "../../storage");
  }

  private normalizedType(requestedType: string, mimeType: string) {
    if (mimeType === "application/pdf") return "PDF";
    if (requestedType === "COURSE_COVER" && mimeType.startsWith("image/")) return "COURSE_COVER";
    if (mimeType.startsWith("image/")) return "IMAGE";
    return "OTHER";
  }

  async upload(file: { buffer: Buffer; originalname: string; mimetype: string; size: number }, actor: AuthUser, requestedType = "OTHER", requestId?: string) {
    const type = this.normalizedType(requestedType, file.mimetype);
    if (requestedType === "PDF" && file.mimetype !== "application/pdf") {
      throw new BadRequestException({ code: "PDF_FILE_REQUIRED", message: "Upload a PDF file" });
    }
    if (requestedType === "COURSE_COVER" && !file.mimetype.startsWith("image/")) {
      throw new BadRequestException({ code: "IMAGE_FILE_REQUIRED", message: "Course cover must be an image" });
    }
    if (type === "PDF") {
      const maxSizeMb = await numberSchoolSetting(this.db, "course_pdf_max_size_mb", 30);
      if (file.size > maxSizeMb * 1024 * 1024) {
        throw new BadRequestException({ code:"PDF_FILE_TOO_LARGE",message:`Course PDF cannot exceed ${maxSizeMb} MB` });
      }
    }

    await mkdir(this.root(), { recursive: true });
    const extension = extname(file.originalname).slice(0, 12).toLowerCase();
    const key = `${randomUUID()}${extension}`;
    await writeFile(resolve(this.root(), key), file.buffer);
    const checksum = createHash("sha256").update(file.buffer).digest("hex");
    const status = type === "PDF" ? "PROCESSING" : "READY";

    return this.db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        INSERT INTO assets(type,status,storage_key,original_filename,mime_type,size_bytes,checksum,uploaded_by)
        VALUES(${type},${status},${key},${file.originalname},${file.mimetype},${file.size},${checksum},${actor.id})
        RETURNING *
      `);
      const asset = result.rows[0] as any;
      if (type === "PDF") {
        await this.outbox.publish({
          eventType: "FILE_PROCESS_PDF",
          aggregateType: "Asset",
          aggregateId: asset.id,
          payload: { assetId: asset.id, storageKey: key },
        }, tx as any);
      }
      await this.audit.record({
        actorUserId: actor.id,
        actorRoleCode: actor.roles[0],
        action: "UPLOAD_COURSE_ASSET",
        entityType: "Asset",
        entityId: asset.id,
        afterData: { type, status, originalFilename: file.originalname, sizeBytes: file.size, checksum },
        requestId,
      }, tx as any);
      return asset;
    });
  }

  private async canRead(assetId: string, actor: AuthUser) {
    if (actor.permissions.includes("course.manage")) return true;
    const assetResult = await this.db.execute(sql`SELECT id,type FROM assets WHERE id=${assetId}`);
    if (!assetResult.rowCount) return false;
    const asset = assetResult.rows[0] as any;

    // Learners never receive the original PDF asset. They only receive processed page assets.
    if (asset.type === "PDF") return false;

    const result = await this.db.execute(sql`
      SELECT 1
      FROM assets target
      LEFT JOIN pdf_processed_pages page ON page.page_asset_id=target.id
      LEFT JOIN course_lesson_blocks b ON b.asset_id=COALESCE(page.source_asset_id,target.id)
      LEFT JOIN course_lessons l ON l.id=b.lesson_id
      LEFT JOIN course_modules m ON m.id=l.module_id
      LEFT JOIN course_licenses cl ON cl.course_id=m.course_id AND cl.status='ACTIVE' AND cl.ends_at>now()
      LEFT JOIN course_enrollments ce ON ce.license_id=cl.id
      LEFT JOIN students st ON st.id=ce.student_id
      LEFT JOIN parent_profiles pp ON pp.family_id=st.family_id
      LEFT JOIN courses cover_course ON cover_course.cover_asset_id=target.id AND cover_course.status='PUBLISHED'
      WHERE target.id=${assetId}
        AND (
          st.user_id=${actor.id}
          OR pp.user_id=${actor.id}
          OR (cover_course.id IS NOT NULL AND ${actor.permissions.includes("course.view")})
        )
      LIMIT 1
    `);
    return Boolean(result.rowCount);
  }

  async meta(assetId: string, actor: AuthUser) {
    if (!(await this.canRead(assetId, actor))) throw new ForbiddenException({ code: "ASSET_SCOPE_DENIED", message: "You cannot access this file" });
    const result = await this.db.execute(sql`
      SELECT a.*,
        COALESCE((SELECT COUNT(*)::int FROM pdf_processed_pages p WHERE p.source_asset_id=a.id),0) page_count
      FROM assets a WHERE a.id=${assetId}
    `);
    if (!result.rowCount) throw new NotFoundException({ code: "ASSET_NOT_FOUND", message: "File not found" });
    return result.rows[0];
  }

  async content(assetId: string, actor: AuthUser) {
    if (!(await this.canRead(assetId, actor))) throw new ForbiddenException({ code: "ASSET_SCOPE_DENIED", message: "You cannot access this file" });
    const result = await this.db.execute(sql`SELECT * FROM assets WHERE id=${assetId} AND status='READY'`);
    if (!result.rowCount) throw new NotFoundException({ code: "ASSET_NOT_FOUND", message: "File is not ready" });
    const asset = result.rows[0] as any;
    const buffer = await readFile(resolve(this.root(), asset.storage_key));
    return { asset, buffer };
  }
}
