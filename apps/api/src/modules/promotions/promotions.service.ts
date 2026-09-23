import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Database } from "@school/db";
import { sql } from "drizzle-orm";
import { DATABASE } from "../../common/database/database.constants";
import type { AuthUser } from "../auth/types";
import { AuditService } from "../audit/audit.service";
import type { CreatePromotionDto } from "./dto/promotion.dto";

type QuoteInput = {
  productType: "REGULAR_LESSONS" | "FIRST_LESSON" | "COURSE";
  subjectId?: string;
  courseId?: string;
  planId?: string;
  quantity?: number;
  code?: string;
};

type PromotionRow = {
  id: string;
  name: string;
  discount_type: "PERCENT" | "FIXED_AMOUNT" | "SPECIAL_PRICE";
  discount_value: string | number;
  code: string | null;
  is_automatic: boolean;
};

@Injectable()
export class PromotionsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(includeInactive = false) {
    const result = await this.db.execute(sql`
      SELECT
        p.*,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'productType', t.product_type,
              'subjectId', t.subject_id,
              'subjectName', s.name,
              'courseId', t.course_id,
              'courseTitle', c.title
            ) ORDER BY t.product_type
          ) FILTER (WHERE t.id IS NOT NULL),
          '[]'::jsonb
        ) AS targets
      FROM promotions p
      LEFT JOIN promotion_targets t ON t.promotion_id=p.id
      LEFT JOIN subjects s ON s.id=t.subject_id
      LEFT JOIN courses c ON c.id=t.course_id
      WHERE (${includeInactive} OR p.is_active=true)
      GROUP BY p.id
      ORDER BY p.starts_at DESC, p.created_at DESC
    `);
    return result.rows;
  }

  async create(dto: CreatePromotionDto, actor: AuthUser, requestId?: string) {
    if (new Date(dto.endsAt).getTime() <= new Date(dto.startsAt).getTime()) {
      throw new BadRequestException({ code: "PROMOTION_DATES_INVALID", message: "Promotion end must be after its start" });
    }
    if (dto.discountType === "PERCENT" && dto.discountValue > 100) {
      throw new BadRequestException({ code: "PROMOTION_PERCENT_INVALID", message: "Percent discount must be between 0 and 100" });
    }
    if (dto.productType === "COURSE" && dto.subjectId) {
      throw new BadRequestException({ code: "PROMOTION_TARGET_INVALID", message: "Course promotions cannot target a subject" });
    }
    if (dto.productType !== "COURSE" && dto.courseId) {
      throw new BadRequestException({ code: "PROMOTION_TARGET_INVALID", message: "Lesson promotions cannot target a course" });
    }
    if (dto.code && dto.isAutomatic !== false) {
      throw new BadRequestException({ code: "PROMOTION_CODE_MODE_INVALID", message: "A promo-code promotion must not be automatic" });
    }

    try {
      return await this.db.transaction(async (tx) => {
        const result = await tx.execute(sql`
          INSERT INTO promotions(
            name, discount_type, discount_value, code, is_automatic,
            starts_at, ends_at, created_by, updated_at
          ) VALUES(
            ${dto.name.trim()}, ${dto.discountType}, ${dto.discountValue},
            ${dto.code?.trim().toUpperCase() || null}, ${dto.isAutomatic ?? !dto.code},
            ${new Date(dto.startsAt)}, ${new Date(dto.endsAt)}, ${actor.id}, now()
          )
          RETURNING *
        `);
        const promotion = result.rows[0] as any;

        await tx.execute(sql`
          INSERT INTO promotion_targets(promotion_id, product_type, subject_id, course_id)
          VALUES(${promotion.id}, ${dto.productType}, ${dto.subjectId ?? null}, ${dto.courseId ?? null})
        `);

        await this.audit.record({
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "CREATE_PROMOTION",
          entityType: "Promotion",
          entityId: promotion.id,
          afterData: dto,
          requestId,
        }, tx as any);

        return promotion;
      });
    } catch (error: any) {
      if (error?.code === "23505") {
        throw new ConflictException({ code: "PROMOTION_CODE_EXISTS", message: "This promotion code already exists" });
      }
      throw error;
    }
  }

  async disable(id: string, actor: AuthUser, requestId?: string) {
    return this.db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        UPDATE promotions
        SET is_active=false, updated_at=now()
        WHERE id=${id} AND is_active=true
        RETURNING *
      `);
      if (!result.rowCount) throw new NotFoundException({ code: "PROMOTION_NOT_FOUND", message: "Active promotion not found" });
      await this.audit.record({
        actorUserId: actor.id,
        actorRoleCode: actor.roles[0],
        action: "DISABLE_PROMOTION",
        entityType: "Promotion",
        entityId: id,
        beforeData: { isActive: true },
        afterData: { isActive: false },
        requestId,
      }, tx as any);
      return result.rows[0];
    });
  }

  private discount(baseMinor: number, promotion: PromotionRow) {
    const value = Number(promotion.discount_value);
    if (promotion.discount_type === "PERCENT") return Math.min(baseMinor, Math.round(baseMinor * value / 100));
    if (promotion.discount_type === "FIXED_AMOUNT") return Math.min(baseMinor, value);
    if (promotion.discount_type === "SPECIAL_PRICE") return Math.max(0, baseMinor - Math.min(baseMinor, value));
    return 0;
  }

  async quote(input: QuoteInput) {
    if (!["REGULAR_LESSONS", "FIRST_LESSON", "COURSE"].includes(input.productType)) {
      throw new BadRequestException({ code: "PRODUCT_TYPE_INVALID", message: "Unsupported pricing product type" });
    }

    let baseMinor = 0;
    let currency = "UAH";
    let priceVersionId: string | null = null;
    let unitPriceMinor: number | null = null;
    let courseId = input.courseId;
    const quantity = input.productType === "REGULAR_LESSONS" ? Math.max(1, Math.trunc(input.quantity ?? 1)) : 1;

    if (input.productType === "REGULAR_LESSONS" || input.productType === "FIRST_LESSON") {
      if (!input.subjectId) throw new BadRequestException({ code: "SUBJECT_REQUIRED", message: "subjectId is required" });
      const priceResult = await this.db.execute(sql`
        SELECT * FROM subject_price_versions
        WHERE subject_id=${input.subjectId}
          AND effective_from<=current_date
          AND (effective_until IS NULL OR effective_until>=current_date)
        ORDER BY effective_from DESC
        LIMIT 1
      `);
      if (!priceResult.rowCount) throw new NotFoundException({ code: "PRICE_NOT_FOUND", message: "Subject price is not configured" });
      const price = priceResult.rows[0] as any;
      currency = price.currency;
      priceVersionId = price.id;
      unitPriceMinor = input.productType === "FIRST_LESSON"
        ? Number(price.first_lesson_price_minor)
        : Number(price.regular_60_price_minor);
      baseMinor = unitPriceMinor * quantity;
    } else {
      if (!input.planId) throw new BadRequestException({ code: "PLAN_REQUIRED", message: "planId is required" });
      const planResult = await this.db.execute(sql`SELECT * FROM course_access_plans WHERE id=${input.planId} AND is_active=true LIMIT 1`);
      if (!planResult.rowCount) throw new NotFoundException({ code: "PLAN_NOT_FOUND", message: "Course access plan not found" });
      const plan = planResult.rows[0] as any;
      baseMinor = Number(plan.price_minor);
      unitPriceMinor = baseMinor;
      currency = plan.currency;
      courseId = plan.course_id;
    }

    const normalizedCode = input.code?.trim().toUpperCase() || null;
    const promoResult = await this.db.execute(sql`
      SELECT DISTINCT p.*
      FROM promotions p
      JOIN promotion_targets t ON t.promotion_id=p.id
      WHERE p.is_active=true
        AND p.starts_at<=now()
        AND p.ends_at>now()
        AND t.product_type::text=${input.productType}
        AND (
          (${input.productType}::text IN ('REGULAR_LESSONS','FIRST_LESSON')
            AND t.course_id IS NULL
            AND (t.subject_id IS NULL OR t.subject_id=${input.subjectId ?? null}::uuid))
          OR
          (${input.productType}::text='COURSE'
            AND t.subject_id IS NULL
            AND (t.course_id IS NULL OR t.course_id=${courseId ?? null}::uuid))
        )
        AND (
          p.is_automatic=true
          OR (${normalizedCode}::text IS NOT NULL AND upper(p.code)=upper(${normalizedCode}))
        )
    `);

    const rows = promoResult.rows as unknown as PromotionRow[];
    if (normalizedCode && !rows.some((row) => row.code && row.code.toUpperCase() === normalizedCode)) {
      throw new BadRequestException({ code: "PROMOTION_CODE_INVALID", message: "Promo code is invalid or inactive" });
    }

    let best: PromotionRow | null = null;
    let bestDiscount = 0;
    for (const promotion of rows) {
      const amount = this.discount(baseMinor, promotion);
      if (amount > bestDiscount) {
        best = promotion;
        bestDiscount = amount;
      }
    }

    return {
      productType: input.productType,
      subjectId: input.subjectId ?? null,
      courseId: courseId ?? null,
      priceVersionId,
      quantity,
      unitPriceMinor,
      baseMinor,
      discountMinor: bestDiscount,
      totalMinor: Math.max(0, baseMinor - bestDiscount),
      currency,
      promotion: best ? {
        id: best.id,
        name: best.name,
        discountType: best.discount_type,
        discountValue: Number(best.discount_value),
        code: best.code,
      } : null,
    };
  }
}
