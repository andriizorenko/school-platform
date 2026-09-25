import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  firstLessonOrders,
  lessonCreditAllocations,
  lessonCreditDebits,
  lessonCreditGrants,
  lessonCreditTransfers,
  lessonCheckoutIntents,
  lessonTopups,
  liveSessions,
  orders,
  orderPromotions,
  parentProfiles,
  paymentProviderEvents,
  paymentRefunds,
  payments,
  sessionCreditReservations,
  studentSubjectEnrollments,
  students,
  subjectPriceVersions,
  subjects,
  teacherAssignments,
} from "@school/db";
import type { Database } from "@school/db";
import { and, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database/database.constants";
import { isPgExclusionViolation, pgConstraint } from "../../common/database/pg-errors";
import { addDaysToDateOnly, todayInSchoolTimeZone } from "../../common/time/kyiv-time";
import type { AuthUser } from "../auth/types";
import { AuditService } from "../audit/audit.service";
import { PromotionsService } from "../promotions/promotions.service";
import { FundingMaterializerService } from "../scheduling/funding-materializer.service";
import type { CreateSubjectPriceDto } from "./dto/create-subject-price.dto";
import type { ManualLessonTopupDto } from "./dto/manual-lesson-topup.dto";
import type { RecordFirstLessonPaymentDto } from "./dto/record-first-lesson-payment.dto";
import type { TransferLessonBalanceDto } from "./dto/transfer-lesson-balance.dto";
import type { BalanceNoteDto } from "./dto/balance-note.dto";
import type { ParentLessonCheckoutDto } from "./dto/parent-lesson-checkout.dto";
import type { RefundPaymentDto } from "./dto/refund-payment.dto";
import { LiqPayService } from "./providers/liqpay.service";
import { MonoService, type MonoWebhookPayload } from "./providers/mono.service";
import { PaymentProvidersService } from "./providers/payment-providers.service";
import type { PaymentProviderName } from "./providers/payment-provider";

const PRIVILEGED_ROLES = new Set(["ADMIN", "MANAGER", "SUPPORT_MANAGER"]);

@Injectable()
export class BillingService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly fundingMaterializer: FundingMaterializerService,
    private readonly promotions: PromotionsService,
    private readonly liqpay: LiqPayService,
    private readonly mono: MonoService,
    private readonly paymentProviders: PaymentProvidersService,
  ) {}

  async createSubjectPrice(subjectId: string, dto: CreateSubjectPriceDto, actor: AuthUser, requestId?: string) {
    if (dto.effectiveUntil && dto.effectiveUntil < dto.effectiveFrom) {
      throw new BadRequestException({ code: "INVALID_PRICE_PERIOD", message: "Price period end must be on or after its start" });
    }

    try {
      return await this.db.transaction(async (tx) => {
        const subjectResult = await tx.execute(sql`
          SELECT id, name, status
          FROM subjects
          WHERE id = ${subjectId}
          FOR UPDATE
        `);
        if (!subjectResult.rowCount) {
          throw new NotFoundException({ code: "SUBJECT_NOT_FOUND", message: "Subject not found" });
        }

        const [openPrevious] = await tx
          .select({ id: subjectPriceVersions.id, effectiveFrom: subjectPriceVersions.effectiveFrom })
          .from(subjectPriceVersions)
          .where(
            and(
              eq(subjectPriceVersions.subjectId, subjectId),
              isNull(subjectPriceVersions.effectiveUntil),
              lte(subjectPriceVersions.effectiveFrom, dto.effectiveFrom),
            ),
          )
          .orderBy(desc(subjectPriceVersions.effectiveFrom))
          .limit(1);

        if (openPrevious && openPrevious.effectiveFrom < dto.effectiveFrom) {
          await tx
            .update(subjectPriceVersions)
            .set({ effectiveUntil: addDaysToDateOnly(dto.effectiveFrom, -1) })
            .where(eq(subjectPriceVersions.id, openPrevious.id));
        }

        const [price] = await tx
          .insert(subjectPriceVersions)
          .values({
            subjectId,
            regular60PriceMinor: dto.regular60PriceMinor,
            firstLessonPriceMinor: dto.firstLessonPriceMinor,
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
            action: "CREATE_SUBJECT_PRICE_VERSION",
            entityType: "SubjectPriceVersion",
            entityId: price.id,
            requestId,
            afterData: price,
          },
          tx,
        );

        return { ...price, regular30PriceMinor: Math.floor(price.regular60PriceMinor / 2) };
      });
    } catch (error) {
      if (isPgExclusionViolation(error) && pgConstraint(error) === "subject_price_no_overlap") {
        throw new ConflictException({
          code: "SUBJECT_PRICE_PERIOD_CONFLICT",
          message: "The subject already has a price version overlapping this period",
        });
      }
      throw error;
    }
  }

  async getCurrentSubjectPrice(subjectId: string, onDate = todayInSchoolTimeZone()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(onDate)) {
      throw new BadRequestException({ code: "INVALID_PRICE_DATE", message: "Date must use YYYY-MM-DD format" });
    }

    const [subject] = await this.db
      .select({ id: subjects.id })
      .from(subjects)
      .where(eq(subjects.id, subjectId))
      .limit(1);
    if (!subject) throw new NotFoundException({ code: "SUBJECT_NOT_FOUND", message: "Subject not found" });

    const [price] = await this.db
      .select()
      .from(subjectPriceVersions)
      .where(
        and(
          eq(subjectPriceVersions.subjectId, subjectId),
          lte(subjectPriceVersions.effectiveFrom, onDate),
          or(isNull(subjectPriceVersions.effectiveUntil), sql`${subjectPriceVersions.effectiveUntil} >= ${onDate}`),
        ),
      )
      .orderBy(desc(subjectPriceVersions.effectiveFrom))
      .limit(1);

    if (!price) {
      throw new NotFoundException({ code: "SUBJECT_PRICE_NOT_CONFIGURED", message: "No active price is configured for this subject" });
    }

    return { ...price, regular30PriceMinor: Math.floor(price.regular60PriceMinor / 2) };
  }

  async recordFirstLessonPayment(sessionId: string, dto: RecordFirstLessonPaymentDto, actor: AuthUser, requestId?: string) {
    const preflight = await this.db.execute(sql`SELECT subject_id FROM live_sessions WHERE id=${sessionId} LIMIT 1`);
    if (!preflight.rowCount) throw new NotFoundException({ code: "SESSION_NOT_FOUND", message: "First lesson not found" });
    const firstLessonQuote = await this.promotions.quote({
      productType: "FIRST_LESSON",
      subjectId: (preflight.rows[0] as any).subject_id,
    });

    return this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT s.id, s.student_id, s.subject_id, s.session_type, s.funding_status, s.status, s.starts_at, st.family_id
        FROM live_sessions s
        JOIN students st ON st.id = s.student_id
        WHERE s.id = ${sessionId}
        FOR UPDATE OF s
      `);
      if (!locked.rowCount) {
        throw new NotFoundException({ code: "SESSION_NOT_FOUND", message: "First lesson not found" });
      }

      const rawSession = locked.rows[0] as {
        id: string;
        student_id: string;
        subject_id: string;
        session_type: string;
        funding_status: string;
        status: string;
        family_id: string;
        starts_at: Date | string;
      };
      const session = {
        ...rawSession,
        starts_at: new Date(rawSession.starts_at),
      };

      if (session.session_type !== "FIRST") {
        throw new ConflictException({ code: "FIRST_LESSON_REQUIRED", message: "This payment endpoint is only for first lessons" });
      }
      if (session.status !== "SCHEDULED") {
        throw new ConflictException({ code: "SESSION_NOT_SCHEDULED", message: "Only a scheduled first lesson can be paid" });
      }
      if (session.funding_status === "PAID") {
        throw new ConflictException({ code: "FIRST_LESSON_ALREADY_PAID", message: "First lesson is already financially covered" });
      }
      if (Date.now() >= session.starts_at.getTime()) {
        throw new ConflictException({
          code: "FIRST_LESSON_PAYMENT_DEADLINE_PASSED",
          message: "First lesson must be paid before its scheduled start",
        });
      }

      const today = todayInSchoolTimeZone();
      const [price] = await tx
        .select()
        .from(subjectPriceVersions)
        .where(
          and(
            eq(subjectPriceVersions.subjectId, session.subject_id),
            lte(subjectPriceVersions.effectiveFrom, today),
            or(isNull(subjectPriceVersions.effectiveUntil), sql`${subjectPriceVersions.effectiveUntil} >= ${today}`),
          ),
        )
        .orderBy(desc(subjectPriceVersions.effectiveFrom))
        .limit(1);

      if (!price) {
        throw new ConflictException({
          code: "SUBJECT_PRICE_NOT_CONFIGURED",
          message: "Configure the subject price before recording first-lesson payment",
        });
      }
      if (dto.amountMinor > price.firstLessonPriceMinor) {
        throw new BadRequestException({
          code: "FIRST_LESSON_AMOUNT_EXCEEDS_PRICE",
          message: "Recorded amount cannot exceed the current first-lesson price",
          details: { basePriceMinor: price.firstLessonPriceMinor, amountMinor: dto.amountMinor },
        });
      }

      const now = new Date();
      const [order] = await tx
        .insert(orders)
        .values({
          familyId: session.family_id,
          source: "MANAGER",
          status: "PAID",
          currency: price.currency,
          subtotalMinor: price.firstLessonPriceMinor,
          discountMinor: price.firstLessonPriceMinor - dto.amountMinor,
          totalMinor: dto.amountMinor,
          createdBy: actor.id,
          paidAt: now,
        })
        .returning();

      const [payment] = await tx
        .insert(payments)
        .values({
          orderId: order.id,
          amountMinor: dto.amountMinor,
          currency: price.currency,
          method: dto.paymentMethod,
          status: "SUCCEEDED",
          recordedBy: actor.id,
          paidAt: now,
        })
        .returning();

      const [firstLessonOrder] = await tx
        .insert(firstLessonOrders)
        .values({
          orderId: order.id,
          sessionId,
          subjectPriceVersionId: price.id,
          basePriceMinor: price.firstLessonPriceMinor,
          finalPriceMinor: dto.amountMinor,
          currency: price.currency,
        })
        .returning();

      const appliedPromotion = dto.amountMinor === firstLessonQuote.totalMinor ? firstLessonQuote.promotion : null;
      if (appliedPromotion) {
        await tx.insert(orderPromotions).values({
          orderId: order.id,
          promotionId: appliedPromotion.id,
          promotionNameSnapshot: appliedPromotion.name,
          discountType: appliedPromotion.discountType,
          discountValue: appliedPromotion.discountValue,
          discountMinor: firstLessonQuote.discountMinor,
        });
      }

      await tx
        .update(liveSessions)
        .set({ fundingStatus: "PAID", updatedAt: now })
        .where(eq(liveSessions.id, sessionId));

      await this.audit.record(
        {
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "RECORD_FIRST_LESSON_PAYMENT",
          entityType: "LiveSession",
          entityId: sessionId,
          requestId,
          beforeData: { fundingStatus: session.funding_status },
          afterData: {
            fundingStatus: "PAID",
            basePriceMinor: price.firstLessonPriceMinor,
            finalPriceMinor: dto.amountMinor,
            paymentMethod: dto.paymentMethod,
            note: dto.note,
            promotionId: appliedPromotion?.id ?? null,
          },
        },
        tx,
      );

      return { order, payment, firstLessonOrder };
    });
  }

  async getEnrollmentBalance(enrollmentId: string, actor: AuthUser) {
    await this.assertCanViewEnrollmentBalance(enrollmentId, actor);

    const result = await this.db.execute(sql`
      SELECT
        e.id,
        e.student_id,
        e.subject_id,
        COALESCE((SELECT SUM(g.credits_granted) FROM lesson_credit_grants g WHERE g.enrollment_id = e.id), 0)::int AS granted_credits,
        COALESCE((SELECT SUM(d.credits_debited) FROM lesson_credit_debits d WHERE d.enrollment_id = e.id), 0)::int AS debited_credits,
        COALESCE((SELECT SUM(r.credits_reserved) FROM session_credit_reservations r WHERE r.enrollment_id = e.id AND r.status = 'ACTIVE'), 0)::int AS reserved_credits
      FROM student_subject_enrollments e
      WHERE e.id = ${enrollmentId}
    `);

    if (!result.rowCount) throw new NotFoundException({ code: "ENROLLMENT_NOT_FOUND", message: "Enrollment not found" });
    const row = result.rows[0] as Record<string, number | string>;
    const grantedCredits = Number(row.granted_credits);
    const debitedCredits = Number(row.debited_credits);
    const reservedCredits = Number(row.reserved_credits);
    const balanceCredits = grantedCredits - debitedCredits;

    return {
      enrollmentId,
      balanceCredits,
      balanceLessonUnits: balanceCredits / 2,
      reservedCredits,
      reservedLessonUnits: reservedCredits / 2,
      unreservedCredits: Math.max(0, balanceCredits - reservedCredits),
      unreservedLessonUnits: Math.max(0, balanceCredits - reservedCredits) / 2,
    };
  }

  async manualTopup(enrollmentId: string, dto: ManualLessonTopupDto, actor: AuthUser, requestId?: string) {
    try {
      return await this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT e.id, e.subject_id, e.status, s.family_id
        FROM student_subject_enrollments e
        JOIN students s ON s.id = e.student_id
        WHERE e.id = ${enrollmentId}
        FOR UPDATE OF e
      `);
      if (!locked.rowCount) {
        throw new NotFoundException({ code: "ENROLLMENT_NOT_FOUND", message: "Enrollment not found" });
      }

      const enrollment = locked.rows[0] as { id: string; subject_id: string; status: string; family_id: string };
      if (enrollment.status === "INACTIVE") {
        throw new ConflictException({ code: "ENROLLMENT_INACTIVE", message: "Cannot top up an inactive enrollment" });
      }

      const today = todayInSchoolTimeZone();
      const [price] = await tx
        .select()
        .from(subjectPriceVersions)
        .where(
          and(
            eq(subjectPriceVersions.subjectId, enrollment.subject_id),
            lte(subjectPriceVersions.effectiveFrom, today),
            or(isNull(subjectPriceVersions.effectiveUntil), sql`${subjectPriceVersions.effectiveUntil} >= ${today}`),
          ),
        )
        .orderBy(desc(subjectPriceVersions.effectiveFrom))
        .limit(1);

      if (!price) {
        throw new ConflictException({
          code: "SUBJECT_PRICE_NOT_CONFIGURED",
          message: "Configure the subject price before recording a lesson purchase",
        });
      }

      const subtotalMinor = price.regular60PriceMinor * dto.lessonUnits;
      if (dto.amountMinor > subtotalMinor) {
        throw new BadRequestException({
          code: "MANUAL_TOPUP_AMOUNT_EXCEEDS_CURRENT_PRICE",
          message: "Recorded payment cannot exceed the current price for the selected lesson quantity",
          details: { subtotalMinor, amountMinor: dto.amountMinor },
        });
      }

      const now = new Date();
      const [order] = await tx
        .insert(orders)
        .values({
          familyId: enrollment.family_id,
          source: "MANAGER",
          status: "PAID",
          currency: price.currency,
          subtotalMinor,
          discountMinor: subtotalMinor - dto.amountMinor,
          totalMinor: dto.amountMinor,
          createdBy: actor.id,
          paidAt: now,
        })
        .returning();

      const [payment] = await tx
        .insert(payments)
        .values({
          orderId: order.id,
          amountMinor: dto.amountMinor,
          currency: price.currency,
          method: dto.paymentMethod,
          status: "SUCCEEDED",
          recordedBy: actor.id,
          paidAt: now,
        })
        .returning();

      const creditsGranted = dto.lessonUnits * 2;
      const [topup] = await tx
        .insert(lessonTopups)
        .values({
          orderId: order.id,
          enrollmentId,
          subjectPriceVersionId: price.id,
          lessonUnits: dto.lessonUnits,
          creditsGranted,
          baseUnitPriceMinor: price.regular60PriceMinor,
          finalTotalMinor: dto.amountMinor,
        })
        .returning();

      await tx.insert(lessonCreditGrants).values({
        enrollmentId,
        type: "PURCHASE",
        creditsGranted,
        lessonTopupId: topup.id,
        createdBy: actor.id,
      });

      const fundingPlan = await this.fundingMaterializer.refreshEnrollment(enrollmentId, actor.id, tx);

      await this.audit.record(
        {
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "MANUAL_LESSON_TOPUP",
          entityType: "LessonTopup",
          entityId: topup.id,
          requestId,
          afterData: {
            enrollmentId,
            lessonUnits: dto.lessonUnits,
            creditsGranted,
            amountMinor: dto.amountMinor,
            paymentMethod: dto.paymentMethod,
            priceVersionId: price.id,
            note: dto.note,
            fundingPlan,
          },
        },
        tx,
      );

        return { order, payment, topup, fundingPlan };
      });
    } catch (error) {
      if (isPgExclusionViolation(error)) {
        const constraint = pgConstraint(error);
        if (constraint === "teacher_session_no_overlap") {
          throw new ConflictException({ code: "TEACHER_SESSION_CONFLICT", message: "Teacher already has a lesson in this time range" });
        }
        if (constraint === "student_session_no_overlap") {
          throw new ConflictException({ code: "STUDENT_SESSION_CONFLICT", message: "Student already has a lesson in this time range" });
        }
      }
      throw error;
    }
  }

  async transferLessonBalance(
    fromEnrollmentId: string,
    dto: TransferLessonBalanceDto,
    actor: AuthUser,
    requestId?: string,
  ) {
    const credits = Math.round(dto.lessonUnits * 2);
    if (!Number.isInteger(dto.lessonUnits * 2) || credits <= 0) {
      throw new BadRequestException({
        code: "INVALID_TRANSFER_LESSON_UNITS",
        message: "Lesson units must be positive and use 0.5 increments",
      });
    }
    if (fromEnrollmentId === dto.toEnrollmentId) {
      throw new BadRequestException({ code: "TRANSFER_SAME_ENROLLMENT", message: "Source and destination must be different" });
    }

    return this.db.transaction(async (tx) => {
      const enrollmentRows = await tx.execute(sql`
        SELECT e.id, e.subject_id, e.status, s.family_id
        FROM student_subject_enrollments e
        JOIN students s ON s.id = e.student_id
        WHERE e.id IN (${fromEnrollmentId}, ${dto.toEnrollmentId})
        ORDER BY e.id
        FOR UPDATE OF e
      `);
      if (enrollmentRows.rowCount !== 2) {
        throw new NotFoundException({ code: "ENROLLMENT_NOT_FOUND", message: "Source or destination enrollment not found" });
      }

      const byId = new Map((enrollmentRows.rows as Array<any>).map((row) => [row.id, row]));
      const source = byId.get(fromEnrollmentId);
      const target = byId.get(dto.toEnrollmentId);
      if (!source || !target) {
        throw new NotFoundException({ code: "ENROLLMENT_NOT_FOUND", message: "Source or destination enrollment not found" });
      }
      if (source.family_id !== target.family_id) {
        throw new ConflictException({
          code: "BALANCE_TRANSFER_DIFFERENT_FAMILIES",
          message: "Lesson balance can only be transferred between children in the same family",
        });
      }
      if (source.subject_id !== target.subject_id) {
        throw new ConflictException({
          code: "BALANCE_TRANSFER_DIFFERENT_SUBJECTS",
          message: "Direct lesson transfer is only allowed between the same subject",
        });
      }
      if (target.status === "INACTIVE") {
        throw new ConflictException({
          code: "TARGET_ENROLLMENT_INACTIVE",
          message: "Reactivate the destination enrollment before transferring lessons",
        });
      }

      const summary = await tx.execute(sql`
        SELECT
          COALESCE((SELECT SUM(credits_granted) FROM lesson_credit_grants WHERE enrollment_id = ${fromEnrollmentId}), 0)::int
          - COALESCE((SELECT SUM(credits_debited) FROM lesson_credit_debits WHERE enrollment_id = ${fromEnrollmentId}), 0)::int AS balance_credits,
          COALESCE((SELECT SUM(credits_reserved) FROM session_credit_reservations WHERE enrollment_id = ${fromEnrollmentId} AND status = 'ACTIVE'), 0)::int AS reserved_credits
      `);
      const balanceCredits = Number((summary.rows[0] as any).balance_credits);
      const reservedCredits = Number((summary.rows[0] as any).reserved_credits);
      if (balanceCredits - reservedCredits < credits) {
        throw new ConflictException({
          code: "INSUFFICIENT_UNRESERVED_CREDITS",
          message: "Not enough unreserved lesson balance to transfer; freeze/end future funding first if the student is stopping",
          details: { balanceCredits, reservedCredits, requestedCredits: credits },
        });
      }

      const grantsResult = await tx.execute(sql`
        SELECT
          g.id,
          g.type,
          (
            g.credits_granted
            - COALESCE((SELECT SUM(a.credits) FROM lesson_credit_allocations a WHERE a.grant_id = g.id), 0)
          )::int AS remaining_credits
        FROM lesson_credit_grants g
        WHERE g.enrollment_id = ${fromEnrollmentId}
          AND g.type <> 'TEACHER_COMPENSATION'
          AND (
            g.credits_granted
            - COALESCE((SELECT SUM(a.credits) FROM lesson_credit_allocations a WHERE a.grant_id = g.id), 0)
          ) > 0
        ORDER BY g.created_at, g.id
        FOR UPDATE OF g
      `);

      let remaining = credits;
      const allocations: Array<{ grantId: string; credits: number }> = [];
      for (const grant of grantsResult.rows as Array<any>) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, Number(grant.remaining_credits));
        if (take > 0) {
          allocations.push({ grantId: grant.id, credits: take });
          remaining -= take;
        }
      }
      if (remaining > 0) {
        throw new ConflictException({
          code: "TRANSFERABLE_CREDITS_INSUFFICIENT",
          message: "Available balance contains teacher compensation credits that cannot be transferred between children",
        });
      }

      const [transfer] = await tx
        .insert(lessonCreditTransfers)
        .values({
          fromEnrollmentId,
          toEnrollmentId: dto.toEnrollmentId,
          credits,
          requestedByParent: dto.requestedByParent ?? true,
          processedBy: actor.id,
          reason: dto.reason?.trim() || undefined,
        })
        .returning();

      const [debit] = await tx
        .insert(lessonCreditDebits)
        .values({
          enrollmentId: fromEnrollmentId,
          type: "TRANSFER_OUT",
          creditsDebited: credits,
          transferId: transfer.id,
          createdBy: actor.id,
        })
        .returning();

      await tx.insert(lessonCreditAllocations).values(
        allocations.map((allocation) => ({
          debitId: debit.id,
          grantId: allocation.grantId,
          credits: allocation.credits,
        })),
      );

      const [grant] = await tx
        .insert(lessonCreditGrants)
        .values({
          enrollmentId: dto.toEnrollmentId,
          type: "TRANSFER_IN",
          creditsGranted: credits,
          sourceTransferId: transfer.id,
          createdBy: actor.id,
        })
        .returning();

      const sourceFunding = await this.fundingMaterializer.refreshEnrollment(fromEnrollmentId, actor.id, tx);
      const targetFunding = await this.fundingMaterializer.refreshEnrollment(dto.toEnrollmentId, actor.id, tx);

      await this.audit.record(
        {
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "TRANSFER_LESSON_BALANCE",
          entityType: "LessonCreditTransfer",
          entityId: transfer.id,
          requestId,
          afterData: {
            fromEnrollmentId,
            toEnrollmentId: dto.toEnrollmentId,
            credits,
            lessonUnits: credits / 2,
            requestedByParent: dto.requestedByParent ?? true,
            reason: dto.reason,
          },
        },
        tx,
      );

      return { transfer, debit, grant, sourceFunding, targetFunding };
    });
  }

  async freezeLessonBalance(enrollmentId: string, dto: BalanceNoteDto, actor: AuthUser, requestId?: string) {
    return this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT id, status
        FROM student_subject_enrollments
        WHERE id = ${enrollmentId}
        FOR UPDATE
      `);
      if (!locked.rowCount) throw new NotFoundException({ code: "ENROLLMENT_NOT_FOUND", message: "Enrollment not found" });
      const before = locked.rows[0] as { id: string; status: string };

      await tx
        .update(studentSubjectEnrollments)
        .set({ status: "PAUSED", pausedAt: new Date(), updatedAt: new Date() })
        .where(eq(studentSubjectEnrollments.id, enrollmentId));

      await tx.execute(sql`
        UPDATE session_credit_reservations r
        SET status = 'RELEASED', updated_at = now()
        FROM live_sessions s
        WHERE r.session_id = s.id
          AND r.enrollment_id = ${enrollmentId}
          AND r.status = 'ACTIVE'
          AND s.status = 'SCHEDULED'
          AND s.starts_at >= now()
      `);
      await tx.execute(sql`
        UPDATE live_sessions
        SET status = 'EXPIRED_UNPAID', funding_status = 'BOOKED', updated_at = now()
        WHERE enrollment_id = ${enrollmentId}
          AND session_type = 'REGULAR'
          AND status = 'SCHEDULED'
          AND starts_at >= now()
      `);

      await this.audit.record(
        {
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "FREEZE_LESSON_BALANCE",
          entityType: "StudentSubjectEnrollment",
          entityId: enrollmentId,
          requestId,
          beforeData: { status: before.status },
          afterData: { status: "PAUSED", note: dto.note },
        },
        tx,
      );

      return { enrollmentId, status: "PAUSED", balanceFrozen: true };
    });
  }

  async writeOffLessonBalance(enrollmentId: string, dto: BalanceNoteDto, actor: AuthUser, requestId?: string) {
    return this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT id, status
        FROM student_subject_enrollments
        WHERE id = ${enrollmentId}
        FOR UPDATE
      `);
      if (!locked.rowCount) throw new NotFoundException({ code: "ENROLLMENT_NOT_FOUND", message: "Enrollment not found" });
      const before = locked.rows[0] as { status: string };

      await tx.execute(sql`
        UPDATE session_credit_reservations r
        SET status = 'RELEASED', updated_at = now()
        FROM live_sessions s
        WHERE r.session_id = s.id
          AND r.enrollment_id = ${enrollmentId}
          AND r.status = 'ACTIVE'
          AND s.status = 'SCHEDULED'
          AND s.starts_at >= now()
      `);
      await tx.execute(sql`
        UPDATE live_sessions
        SET status = 'EXPIRED_UNPAID', funding_status = 'BOOKED', updated_at = now()
        WHERE enrollment_id = ${enrollmentId}
          AND session_type = 'REGULAR'
          AND status = 'SCHEDULED'
          AND starts_at >= now()
      `);

      const unresolvedResult = await tx.execute(sql`
        SELECT COALESCE(SUM(r.credits_reserved), 0)::int AS credits
        FROM session_credit_reservations r
        JOIN live_sessions s ON s.id = r.session_id
        WHERE r.enrollment_id = ${enrollmentId}
          AND r.status = 'ACTIVE'
          AND s.status = 'SCHEDULED'
      `);
      const unresolvedCredits = Number((unresolvedResult.rows[0] as { credits: number | string }).credits);
      if (unresolvedCredits > 0) {
        throw new ConflictException({
          code: "UNRESOLVED_PAID_SESSIONS",
          message: "Resolve or reschedule existing paid lessons before writing off the remaining balance",
          details: { unresolvedCredits, unresolvedLessonUnits: unresolvedCredits / 2 },
        });
      }

      const grantsResult = await tx.execute(sql`
        SELECT
          g.id,
          (
            g.credits_granted
            - COALESCE((SELECT SUM(a.credits) FROM lesson_credit_allocations a WHERE a.grant_id = g.id), 0)
          )::int AS remaining_credits
        FROM lesson_credit_grants g
        WHERE g.enrollment_id = ${enrollmentId}
          AND (
            g.credits_granted
            - COALESCE((SELECT SUM(a.credits) FROM lesson_credit_allocations a WHERE a.grant_id = g.id), 0)
          ) > 0
        ORDER BY g.created_at, g.id
        FOR UPDATE OF g
      `);
      const allocations = (grantsResult.rows as Array<any>)
        .map((grant) => ({ grantId: grant.id as string, credits: Number(grant.remaining_credits) }))
        .filter((grant) => grant.credits > 0);
      const credits = allocations.reduce((sum, grant) => sum + grant.credits, 0);

      let debit: any = null;
      if (credits > 0) {
        [debit] = await tx
          .insert(lessonCreditDebits)
          .values({
            enrollmentId,
            type: "WRITE_OFF",
            creditsDebited: credits,
            createdBy: actor.id,
          })
          .returning();
        await tx.insert(lessonCreditAllocations).values(
          allocations.map((allocation) => ({
            debitId: debit.id,
            grantId: allocation.grantId,
            credits: allocation.credits,
          })),
        );
      }

      await tx
        .update(studentSubjectEnrollments)
        .set({ status: "INACTIVE", inactiveAt: new Date(), pausedAt: null, updatedAt: new Date() })
        .where(eq(studentSubjectEnrollments.id, enrollmentId));

      await this.audit.record(
        {
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "WRITE_OFF_LESSON_BALANCE",
          entityType: "StudentSubjectEnrollment",
          entityId: enrollmentId,
          requestId,
          beforeData: { status: before.status },
          afterData: { status: "INACTIVE", creditsWrittenOff: credits, lessonUnitsWrittenOff: credits / 2, note: dto.note },
        },
        tx,
      );

      return { enrollmentId, status: "INACTIVE", creditsWrittenOff: credits, lessonUnitsWrittenOff: credits / 2, debit };
    });
  }

  async reactivateEnrollment(enrollmentId: string, actor: AuthUser, requestId?: string) {
    return this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT id, status
        FROM student_subject_enrollments
        WHERE id = ${enrollmentId}
        FOR UPDATE
      `);
      if (!locked.rowCount) throw new NotFoundException({ code: "ENROLLMENT_NOT_FOUND", message: "Enrollment not found" });
      const before = locked.rows[0] as { status: string };

      await tx
        .update(studentSubjectEnrollments)
        .set({ status: "ACTIVE", pausedAt: null, inactiveAt: null, updatedAt: new Date() })
        .where(eq(studentSubjectEnrollments.id, enrollmentId));

      const fundingPlan = await this.fundingMaterializer.refreshEnrollment(enrollmentId, actor.id, tx);

      await this.audit.record(
        {
          actorUserId: actor.id,
          actorRoleCode: actor.roles[0],
          action: "REACTIVATE_ENROLLMENT",
          entityType: "StudentSubjectEnrollment",
          entityId: enrollmentId,
          requestId,
          beforeData: { status: before.status },
          afterData: { status: "ACTIVE", fundingPlan },
        },
        tx,
      );

      return { enrollmentId, status: "ACTIVE", fundingPlan };
    });
  }


  async listSubjectPricingOverview() {
    const result = await this.db.execute(sql`
      SELECT
        s.id, s.name, s.slug, s.status,
        cur.id AS current_price_id,
        cur.regular_60_price_minor AS current_regular_60_price_minor,
        cur.first_lesson_price_minor AS current_first_lesson_price_minor,
        cur.currency AS current_currency,
        cur.effective_from AS current_effective_from,
        cur.effective_until AS current_effective_until,
        nxt.id AS next_price_id,
        nxt.regular_60_price_minor AS next_regular_60_price_minor,
        nxt.first_lesson_price_minor AS next_first_lesson_price_minor,
        nxt.currency AS next_currency,
        nxt.effective_from AS next_effective_from,
        (SELECT COUNT(*)::int FROM subject_price_versions pv WHERE pv.subject_id=s.id) AS price_version_count
      FROM subjects s
      LEFT JOIN LATERAL (
        SELECT * FROM subject_price_versions pv
        WHERE pv.subject_id=s.id
          AND pv.effective_from<=current_date
          AND (pv.effective_until IS NULL OR pv.effective_until>=current_date)
        ORDER BY pv.effective_from DESC
        LIMIT 1
      ) cur ON true
      LEFT JOIN LATERAL (
        SELECT * FROM subject_price_versions pv
        WHERE pv.subject_id=s.id AND pv.effective_from>current_date
        ORDER BY pv.effective_from ASC
        LIMIT 1
      ) nxt ON true
      ORDER BY (s.status='ACTIVE') DESC, s.name
    `);
    return result.rows;
  }

  async getSubjectPriceHistory(subjectId: string) {
    const subjectResult = await this.db.execute(sql`SELECT id,name FROM subjects WHERE id=${subjectId} LIMIT 1`);
    if (!subjectResult.rowCount) throw new NotFoundException({ code: "SUBJECT_NOT_FOUND", message: "Subject not found" });
    const rows = await this.db.execute(sql`
      SELECT pv.*, u.email AS created_by_email
      FROM subject_price_versions pv
      JOIN users u ON u.id=pv.created_by
      WHERE pv.subject_id=${subjectId}
      ORDER BY pv.effective_from DESC, pv.created_at DESC
    `);
    return { subject: subjectResult.rows[0], prices: rows.rows };
  }

  async cancelFutureSubjectPrice(subjectId: string, priceId: string, actor: AuthUser, requestId?: string) {
    return this.db.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT * FROM subject_price_versions
        WHERE id=${priceId} AND subject_id=${subjectId}
        FOR UPDATE
      `);
      if (!locked.rowCount) throw new NotFoundException({ code: "SUBJECT_PRICE_NOT_FOUND", message: "Subject price version not found" });
      const price = locked.rows[0] as any;
      const today = todayInSchoolTimeZone();
      if (String(price.effective_from) <= today) {
        throw new ConflictException({ code: "SUBJECT_PRICE_ALREADY_EFFECTIVE", message: "Current or historical prices cannot be deleted" });
      }

      await tx.execute(sql`DELETE FROM subject_price_versions WHERE id=${priceId}`);

      const previous = await tx.execute(sql`
        SELECT id FROM subject_price_versions
        WHERE subject_id=${subjectId} AND effective_from<${price.effective_from}::date
        ORDER BY effective_from DESC LIMIT 1
      `);
      const next = await tx.execute(sql`
        SELECT effective_from FROM subject_price_versions
        WHERE subject_id=${subjectId} AND effective_from>${price.effective_from}::date
        ORDER BY effective_from ASC LIMIT 1
      `);
      if (previous.rowCount) {
        const nextStart = next.rowCount ? String((next.rows[0] as any).effective_from) : null;
        const restoredEnd = nextStart ? addDaysToDateOnly(nextStart, -1) : null;
        await tx.execute(sql`
          UPDATE subject_price_versions
          SET effective_until=${restoredEnd}::date
          WHERE id=${(previous.rows[0] as any).id}
        `);
      }

      await this.audit.record({
        actorUserId: actor.id,
        actorRoleCode: actor.roles[0],
        action: "CANCEL_FUTURE_SUBJECT_PRICE",
        entityType: "SubjectPriceVersion",
        entityId: priceId,
        requestId,
        beforeData: price,
      }, tx as any);
      return { id: priceId, cancelled: true };
    });
  }

  private async parentEnrollmentContext(enrollmentId: string, actor: AuthUser) {
    if (!actor.roles.includes("PARENT")) {
      throw new ForbiddenException({ code: "PARENT_CHECKOUT_ONLY", message: "This checkout is available only in the parent account" });
    }
    const result = await this.db.execute(sql`
      SELECT
        e.id, e.status, e.subject_id,
        st.id AS student_id, st.first_name AS student_first_name, st.last_name AS student_last_name,
        st.family_id,
        sub.name AS subject_name
      FROM student_subject_enrollments e
      JOIN students st ON st.id=e.student_id
      JOIN subjects sub ON sub.id=e.subject_id
      JOIN parent_profiles pp ON pp.family_id=st.family_id AND pp.user_id=${actor.id}
      WHERE e.id=${enrollmentId}
      LIMIT 1
    `);
    if (!result.rowCount) throw new NotFoundException({ code: "ENROLLMENT_NOT_FOUND", message: "Enrollment not found in your family" });
    const row = result.rows[0] as any;
    if (row.status !== "ACTIVE") {
      throw new ConflictException({ code: "ENROLLMENT_NOT_ACTIVE", message: "Online lesson purchase is available only for active learning" });
    }
    return row;
  }

  private async onlineMinimumLessonUnits() {
    const result = await this.db.execute(sql`SELECT value FROM school_settings WHERE key='online_min_lesson_units' LIMIT 1`);
    return result.rowCount ? Math.max(1, Number((result.rows[0] as any).value)) : 10;
  }

  async parentCheckoutConfig(actor: AuthUser) {
    if (!actor.roles.includes("PARENT")) {
      throw new ForbiddenException({ code: "PARENT_CHECKOUT_ONLY", message: "Parent checkout only" });
    }
    const paymentProviders = this.paymentProviders.readyProviders();
    return {
      minimumLessonUnits: await this.onlineMinimumLessonUnits(),
      currency: "UAH",
      paymentIntegrationReady: paymentProviders.length > 0,
      paymentProvider: this.paymentProviders.defaultProvider(),
      paymentProviders,
    };
  }

  async parentLessonCheckoutQuote(enrollmentId: string, lessonUnits: number, promotionCode: string | undefined, actor: AuthUser) {
    const enrollment = await this.parentEnrollmentContext(enrollmentId, actor);
    const minimumLessonUnits = await this.onlineMinimumLessonUnits();
    if (!Number.isInteger(lessonUnits) || lessonUnits < minimumLessonUnits) {
      throw new BadRequestException({
        code: "ONLINE_MIN_LESSON_UNITS",
        message: `Online purchase requires at least ${minimumLessonUnits} lessons`,
        details: { minimumLessonUnits },
      });
    }
    const quote = await this.promotions.quote({
      productType: "REGULAR_LESSONS",
      subjectId: enrollment.subject_id,
      quantity: lessonUnits,
      code: promotionCode,
    });
    return {
      enrollmentId,
      student: { id: enrollment.student_id, firstName: enrollment.student_first_name, lastName: enrollment.student_last_name },
      subject: { id: enrollment.subject_id, name: enrollment.subject_name },
      minimumLessonUnits,
      ...quote,
    };
  }

  async createParentLessonCheckout(
    enrollmentId: string,
    dto: ParentLessonCheckoutDto,
    actor: AuthUser,
    requestId?: string,
  ) {
    const context = await this.parentEnrollmentContext(enrollmentId, actor);
    const minimumLessonUnits = await this.onlineMinimumLessonUnits();
    if (dto.lessonUnits < minimumLessonUnits) {
      throw new BadRequestException({
        code: "ONLINE_MIN_LESSON_UNITS",
        message: `Online purchase requires at least ${minimumLessonUnits} lessons`,
        details: { minimumLessonUnits },
      });
    }

    if (dto.idempotencyKey) {
      const existing = await this.db.execute(sql`
        SELECT
          lci.id AS checkout_id, lci.order_id, lci.payment_provider,
          (
            SELECT p.provider
            FROM payments p
            WHERE p.order_id=lci.order_id AND p.provider IN ('LIQPAY','MONO')
            ORDER BY p.created_at ASC
            LIMIT 1
          ) AS existing_payment_provider
        FROM lesson_checkout_intents lci
        JOIN orders o ON o.id=lci.order_id
        JOIN parent_profiles pp ON pp.family_id=o.family_id AND pp.user_id=${actor.id}
        WHERE lci.idempotency_key=${dto.idempotencyKey}
        LIMIT 1
      `);
      if (existing.rowCount) {
        const existingRow = existing.rows[0] as any;
        const boundProvider = (existingRow.payment_provider ?? existingRow.existing_payment_provider ?? null) as PaymentProviderName | null;
        if (dto.paymentProvider && boundProvider && dto.paymentProvider !== boundProvider) {
          throw new ConflictException({
            code: "CHECKOUT_IDEMPOTENCY_PROVIDER_CONFLICT",
            message: "Checkout idempotency key is already bound to another payment provider",
          });
        }
        const providerToBind = boundProvider ?? (dto.paymentProvider ? this.paymentProviders.resolve(dto.paymentProvider).providerName : null);
        if (providerToBind && existingRow.payment_provider !== providerToBind) {
          await this.db.update(lessonCheckoutIntents)
            .set({ paymentProvider: providerToBind })
            .where(eq(lessonCheckoutIntents.id, existingRow.checkout_id));
        }
        return { ...(await this.prepareParentCheckoutPayment(existingRow.order_id, actor)), reused: true };
      }
    }

    const quote = await this.promotions.quote({
      productType: "REGULAR_LESSONS",
      subjectId: context.subject_id,
      quantity: dto.lessonUnits,
      code: dto.promotionCode,
    });
    if (!quote.priceVersionId || quote.unitPriceMinor == null) {
      throw new ConflictException({ code: "SUBJECT_PRICE_NOT_CONFIGURED", message: "Subject price is not configured" });
    }
    const priceVersionId = quote.priceVersionId;
    const unitPriceMinor = quote.unitPriceMinor;

    const selectedPaymentProvider = quote.totalMinor === 0
      ? null
      : dto.paymentProvider
        ? this.paymentProviders.resolve(dto.paymentProvider).providerName
        : this.paymentProviders.defaultProvider();

    const created = await this.db.transaction(async (tx) => {
      const lock = await tx.execute(sql`
        SELECT e.id, e.status, st.family_id
        FROM student_subject_enrollments e
        JOIN students st ON st.id=e.student_id
        JOIN parent_profiles pp ON pp.family_id=st.family_id AND pp.user_id=${actor.id}
        WHERE e.id=${enrollmentId}
        FOR UPDATE OF e
      `);
      if (!lock.rowCount) throw new NotFoundException({ code: "ENROLLMENT_NOT_FOUND", message: "Enrollment not found" });
      if ((lock.rows[0] as any).status !== "ACTIVE") {
        throw new ConflictException({ code: "ENROLLMENT_NOT_ACTIVE", message: "Learning is no longer active" });
      }

      const zeroAmount = quote.totalMinor === 0;
      const paidAt = zeroAmount ? new Date() : null;
      const [order] = await tx.insert(orders).values({
        familyId: context.family_id,
        source: "ONLINE",
        status: zeroAmount ? "PAID" : "PENDING_PAYMENT",
        currency: quote.currency,
        subtotalMinor: quote.baseMinor,
        discountMinor: quote.discountMinor,
        totalMinor: quote.totalMinor,
        createdBy: actor.id,
        paidAt,
      }).returning();

      const [intent] = await tx.insert(lessonCheckoutIntents).values({
        orderId: order.id,
        enrollmentId,
        subjectPriceVersionId: priceVersionId,
        lessonUnits: dto.lessonUnits,
        creditsToGrant: dto.lessonUnits * 2,
        baseUnitPriceMinor: unitPriceMinor,
        baseTotalMinor: quote.baseMinor,
        discountMinor: quote.discountMinor,
        finalTotalMinor: quote.totalMinor,
        promotionId: quote.promotion?.id ?? null,
        idempotencyKey: dto.idempotencyKey,
        ...(selectedPaymentProvider ? { paymentProvider: selectedPaymentProvider } : {}),
      }).returning();

      if (quote.promotion) {
        await tx.insert(orderPromotions).values({
          orderId: order.id,
          promotionId: quote.promotion.id,
          promotionNameSnapshot: quote.promotion.name,
          discountType: quote.promotion.discountType,
          discountValue: quote.promotion.discountValue,
          discountMinor: quote.discountMinor,
        });
      }

      if (zeroAmount) {
        await tx.insert(payments).values({
          orderId: order.id,
          amountMinor: 0,
          currency: quote.currency,
          method: "OTHER",
          status: "SUCCEEDED",
          provider: "PROMOTION",
          providerStatus: "free_checkout",
          recordedBy: actor.id,
          paidAt: paidAt!,
        });
        const [topup] = await tx.insert(lessonTopups).values({
          orderId: order.id,
          enrollmentId,
          subjectPriceVersionId: quote.priceVersionId,
          lessonUnits: dto.lessonUnits,
          creditsGranted: dto.lessonUnits * 2,
          baseUnitPriceMinor: quote.unitPriceMinor,
          finalTotalMinor: 0,
        }).returning();
        await tx.insert(lessonCreditGrants).values({
          enrollmentId,
          type: "PURCHASE",
          creditsGranted: dto.lessonUnits * 2,
          lessonTopupId: topup.id,
          createdBy: actor.id,
        });
        await this.fundingMaterializer.refreshEnrollment(enrollmentId, actor.id, tx);
      }

      await this.audit.record({
        actorUserId: actor.id,
        actorRoleCode: actor.roles[0],
        action: "CREATE_PARENT_LESSON_CHECKOUT",
        entityType: "Order",
        entityId: order.id,
        requestId,
        afterData: {
          enrollmentId,
          lessonUnits: dto.lessonUnits,
          subtotalMinor: quote.baseMinor,
          discountMinor: quote.discountMinor,
          totalMinor: quote.totalMinor,
          promotionId: quote.promotion?.id ?? null,
          paymentProvider: selectedPaymentProvider,
          zeroAmount,
        },
      }, tx as any);

      return { order, intent };
    });

    return this.prepareParentCheckoutPayment(created.order.id, actor);
  }

  async prepareParentCheckoutPayment(orderId: string, actor: AuthUser) {
    if (!actor.roles.includes("PARENT")) {
      throw new ForbiddenException({ code: "PARENT_CHECKOUT_ONLY", message: "Parent checkout only" });
    }
    const result = await this.db.execute(sql`
      SELECT
        o.id AS order_id, o.status, o.currency, o.total_minor, o.created_by,
        lci.id AS checkout_id, lci.enrollment_id, lci.lesson_units, lci.credits_to_grant,
        lci.base_unit_price_minor, lci.base_total_minor, lci.discount_minor, lci.final_total_minor,
        lci.subject_price_version_id, lci.promotion_id, lci.payment_provider,
        (
          SELECT p.provider
          FROM payments p
          WHERE p.order_id=o.id AND p.status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED')
          ORDER BY p.paid_at DESC NULLS LAST, p.created_at DESC
          LIMIT 1
        ) AS paid_provider
      FROM orders o
      JOIN lesson_checkout_intents lci ON lci.order_id=o.id
      JOIN parent_profiles pp ON pp.family_id=o.family_id AND pp.user_id=${actor.id}
      WHERE o.id=${orderId}
      LIMIT 1
    `);
    if (!result.rowCount) throw new NotFoundException({ code: "ORDER_NOT_FOUND", message: "Checkout order not found" });
    const row = result.rows[0] as any;

    if (["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(row.status)) {
      return {
        order: { id: row.order_id, status: row.status, currency: row.currency, totalMinor: Number(row.total_minor) },
        checkout: { id: row.checkout_id, enrollmentId: row.enrollment_id, lessonUnits: row.lesson_units },
        paymentIntegrationReady: true,
        paymentProvider: row.status === "PAID" && Number(row.total_minor) === 0 ? "PROMOTION" : row.paid_provider ?? row.payment_provider,
        nextStep: "COMPLETED",
      };
    }
    if (row.status === "CANCELLED") {
      throw new ConflictException({ code: "ORDER_CANCELLED", message: "This checkout order has been cancelled" });
    }
    if (row.status !== "PENDING_PAYMENT") {
      throw new ConflictException({ code: "ORDER_NOT_PENDING", message: "This order cannot be paid online" });
    }

    let selectedProvider = row.payment_provider as PaymentProviderName | null;
    if (!selectedProvider) {
      selectedProvider = this.paymentProviders.defaultProvider();
      if (selectedProvider) {
        await this.db.update(lessonCheckoutIntents).set({ paymentProvider: selectedProvider }).where(eq(lessonCheckoutIntents.id, row.checkout_id));
      }
    }

    const availableProviders = this.paymentProviders.readyProviders();
    if (!selectedProvider || !availableProviders.includes(selectedProvider)) {
      return {
        order: { id: row.order_id, status: row.status, currency: row.currency, totalMinor: Number(row.total_minor) },
        checkout: { id: row.checkout_id, enrollmentId: row.enrollment_id, lessonUnits: row.lesson_units },
        paymentIntegrationReady: false,
        paymentProvider: selectedProvider,
        paymentProviders: availableProviders,
        nextStep: "PAYMENT_PROVIDER_NOT_CONFIGURED",
      };
    }

    const provider = this.paymentProviders.resolve(selectedProvider);
    let [payment] = await this.db.select().from(payments)
      .where(and(eq(payments.orderId, row.order_id), eq(payments.provider, selectedProvider)))
      .limit(1);

    if (!payment) {
      [payment] = await this.db.insert(payments).values({
        orderId: row.order_id,
        amountMinor: Number(row.total_minor),
        currency: row.currency,
        method: "CARD",
        status: "PENDING",
        provider: selectedProvider,
        providerStatus: "checkout_creating",
      }).returning();
    }

    if (selectedProvider === "MONO" && payment.providerPaymentId && payment.providerCheckoutUrl) {
      return {
        order: { id: row.order_id, status: row.status, currency: row.currency, totalMinor: Number(row.total_minor) },
        checkout: {
          id: row.checkout_id,
          enrollmentId: row.enrollment_id,
          lessonUnits: row.lesson_units,
          creditsToGrant: row.credits_to_grant,
        },
        paymentIntegrationReady: true,
        paymentProvider: selectedProvider,
        providerCheckout: {
          provider: selectedProvider,
          checkoutUrl: payment.providerCheckoutUrl,
          method: "GET",
          providerPaymentId: payment.providerPaymentId,
        },
        nextStep: "REDIRECT_TO_PROVIDER",
      };
    }

    const providerCheckout = await provider.createCheckout({
      orderId: row.order_id,
      amountMinor: Number(row.total_minor),
      currency: row.currency,
      description: `Math School lessons · ${row.lesson_units} lessons`,
      customerId: actor.id,
    });

    await this.db.update(payments).set({
      providerPaymentId: providerCheckout.providerPaymentId ?? payment.providerPaymentId,
      providerCheckoutUrl: providerCheckout.checkoutUrl,
      providerStatus: "checkout_created",
    }).where(eq(payments.id, payment.id));

    return {
      order: { id: row.order_id, status: row.status, currency: row.currency, totalMinor: Number(row.total_minor) },
      checkout: {
        id: row.checkout_id,
        enrollmentId: row.enrollment_id,
        lessonUnits: row.lesson_units,
        creditsToGrant: row.credits_to_grant,
      },
      paymentIntegrationReady: true,
      paymentProvider: selectedProvider,
      providerCheckout,
      nextStep: "REDIRECT_TO_PROVIDER",
    };
  }

  async cancelParentCheckout(orderId: string, actor: AuthUser, requestId?: string) {
    if (!actor.roles.includes("PARENT")) throw new ForbiddenException({ code: "PARENT_CHECKOUT_ONLY", message: "Parent checkout only" });
    const cancelled = await this.db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        SELECT
          o.id,o.status,
          lci.payment_provider,
          p.id AS payment_id, p.provider, p.provider_payment_id
        FROM orders o
        JOIN parent_profiles pp ON pp.family_id=o.family_id AND pp.user_id=${actor.id}
        JOIN lesson_checkout_intents lci ON lci.order_id=o.id
        LEFT JOIN payments p ON p.order_id=o.id AND p.provider=lci.payment_provider
        WHERE o.id=${orderId}
        FOR UPDATE OF o
      `);
      if (!result.rowCount) throw new NotFoundException({ code: "ORDER_NOT_FOUND", message: "Checkout order not found" });
      const row = result.rows[0] as any;
      if (row.status !== "PENDING_PAYMENT") {
        throw new ConflictException({ code: "ORDER_NOT_PENDING", message: "Only a pending checkout can be cancelled" });
      }
      await tx.execute(sql`UPDATE orders SET status='CANCELLED' WHERE id=${orderId}`);
      if (row.payment_id) {
        await tx.execute(sql`UPDATE payments SET provider_status='checkout_cancelled_local' WHERE id=${row.payment_id}`);
      }
      await this.audit.record({
        actorUserId: actor.id,
        actorRoleCode: actor.roles[0],
        action: "CANCEL_PARENT_LESSON_CHECKOUT",
        entityType: "Order",
        entityId: orderId,
        requestId,
        beforeData: { status: "PENDING_PAYMENT" },
        afterData: { status: "CANCELLED", provider: row.provider ?? row.payment_provider ?? null },
      }, tx as any);
      return {
        orderId,
        status: "CANCELLED" as const,
        paymentId: row.payment_id as string | null,
        provider: (row.provider ?? row.payment_provider ?? null) as PaymentProviderName | null,
        providerPaymentId: row.provider_payment_id as string | null,
      };
    });

    if (!cancelled.provider || !cancelled.providerPaymentId) {
      return { orderId, status: cancelled.status, providerCheckoutInvalidated: null };
    }

    try {
      const provider = this.paymentProviders.resolve(cancelled.provider);
      if (!provider.cancelCheckout) {
        return { orderId, status: cancelled.status, providerCheckoutInvalidated: null };
      }
      await provider.cancelCheckout(cancelled.providerPaymentId);
      if (cancelled.paymentId) {
        await this.db.update(payments).set({ providerStatus: "checkout_invalidated" }).where(eq(payments.id, cancelled.paymentId));
      }
      return { orderId, status: cancelled.status, providerCheckoutInvalidated: true };
    } catch (error) {
      if (cancelled.paymentId) {
        await this.db.update(payments).set({ providerStatus: "checkout_invalidation_unknown" }).where(eq(payments.id, cancelled.paymentId));
      }
      return {
        orderId,
        status: cancelled.status,
        providerCheckoutInvalidated: false,
        warning: {
          code: "PROVIDER_CHECKOUT_INVALIDATION_UNKNOWN",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  async handleLiqPayCallback(data: string | undefined, signature: string | undefined) {
    if (!data || !signature) {
      throw new BadRequestException({ code: "LIQPAY_CALLBACK_INVALID", message: "LiqPay callback requires data and signature" });
    }
    const payload = this.liqpay.verifyCallback(data, signature);
    const orderId = String(payload.order_id ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) {
      throw new BadRequestException({ code: "LIQPAY_ORDER_ID_INVALID", message: "LiqPay callback order_id is invalid" });
    }

    const eventHash = createHash("sha256").update(`${data}.${signature}`, "utf8").digest("hex");
    return this.db.transaction(async (tx) => {
      const [event] = await tx.insert(paymentProviderEvents).values({
        provider: this.liqpay.providerName,
        eventHash,
        orderId: null,
        providerPaymentId: payload.payment_id == null ? null : String(payload.payment_id),
        providerStatus: payload.status == null ? null : String(payload.status),
        payload,
      }).onConflictDoNothing({ target: [paymentProviderEvents.provider, paymentProviderEvents.eventHash] }).returning();

      if (!event) return { ok: true, duplicate: true };

      const locked = await tx.execute(sql`
        SELECT
          o.id AS order_id, o.status AS order_status, o.currency, o.total_minor, o.created_by,
          lci.id AS checkout_id, lci.enrollment_id, lci.subject_price_version_id,
          lci.lesson_units, lci.credits_to_grant, lci.base_unit_price_minor, lci.final_total_minor
        FROM orders o
        JOIN lesson_checkout_intents lci ON lci.order_id=o.id
        WHERE o.id=${orderId}
        FOR UPDATE OF o
      `);
      if (!locked.rowCount) {
        await tx.update(paymentProviderEvents).set({ processedAt: new Date(), processingError: "ORDER_NOT_FOUND" }).where(eq(paymentProviderEvents.id, event.id));
        return { ok: true, ignored: true, reason: "ORDER_NOT_FOUND" };
      }
      const row = locked.rows[0] as any;
      await tx.update(paymentProviderEvents).set({ orderId }).where(eq(paymentProviderEvents.id, event.id));
      const providerStatus = String(payload.status ?? "unknown");
      const providerPaymentId = payload.payment_id == null ? null : String(payload.payment_id);
      const callbackCurrency = String(payload.currency ?? "").toUpperCase();
      const callbackAmountMinor = this.providerAmountMinor(payload.amount);

      let [payment] = await tx.select().from(payments)
        .where(and(eq(payments.orderId, orderId), eq(payments.provider, this.liqpay.providerName)))
        .limit(1);
      if (!payment) {
        [payment] = await tx.insert(payments).values({
          orderId,
          amountMinor: Number(row.total_minor),
          currency: row.currency,
          method: this.paymentMethodFromProvider(payload.paytype),
          status: "PENDING",
          provider: this.liqpay.providerName,
          providerPaymentId,
          providerStatus,
        }).returning();
      }

      const paymentUpdates: Record<string, unknown> = {
        providerStatus,
        method: this.paymentMethodFromProvider(payload.paytype),
      };
      if (providerPaymentId) paymentUpdates.providerPaymentId = providerPaymentId;

      if (providerStatus === "success") {
        if (row.order_status === "CANCELLED") {
          await tx.update(payments).set(paymentUpdates as any).where(eq(payments.id, payment.id));
          await tx.update(paymentProviderEvents).set({
            processedAt: new Date(),
            processingError: "PAYMENT_FOR_CANCELLED_ORDER_REQUIRES_RECONCILIATION",
          }).where(eq(paymentProviderEvents.id, event.id));
          return { ok: true, ignored: true, reason: "PAYMENT_FOR_CANCELLED_ORDER_REQUIRES_RECONCILIATION" };
        }
        if (callbackAmountMinor !== Number(row.total_minor) || callbackCurrency !== String(row.currency).toUpperCase()) {
          await tx.update(payments).set(paymentUpdates as any).where(eq(payments.id, payment.id));
          await tx.update(paymentProviderEvents).set({
            processedAt: new Date(),
            processingError: "PAYMENT_AMOUNT_OR_CURRENCY_MISMATCH",
          }).where(eq(paymentProviderEvents.id, event.id));
          return { ok: true, ignored: true, reason: "PAYMENT_AMOUNT_OR_CURRENCY_MISMATCH" };
        }
        if (["PARTIALLY_REFUNDED", "REFUNDED"].includes(row.order_status) || ["PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status)) {
          await tx.update(payments).set(paymentUpdates as any).where(eq(payments.id, payment.id));
        } else {
          await this.finalizeSuccessfulOnlinePayment(tx, row, payment.id, payload, this.liqpay.providerName);
        }
      } else if (["error", "failure"].includes(providerStatus)) {
        if (!(["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] as string[]).includes(payment.status)) {
          await tx.update(payments).set({ ...paymentUpdates, status: "FAILED" } as any).where(eq(payments.id, payment.id));
        }
      } else if (providerStatus === "reversed") {
        await tx.update(payments).set(paymentUpdates as any).where(eq(payments.id, payment.id));
        const pending = await tx.execute(sql`
          SELECT id, amount_minor
          FROM payment_refunds
          WHERE payment_id=${payment.id} AND status='PENDING'
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE
        `);
        if (pending.rowCount) {
          const expectedCumulative = Number(payment.refundedMinor) + Number((pending.rows[0] as any).amount_minor);
          const callbackRefundMinor = this.providerAmountMinor(payload.refund_amount);
          if (callbackRefundMinor == null || callbackRefundMinor >= expectedCumulative) {
            await this.finalizeRefundInTransaction(tx, (pending.rows[0] as any).id, payload, providerStatus);
          } else {
            await tx.update(paymentProviderEvents).set({ processingError: "REFUND_AMOUNT_MISMATCH" }).where(eq(paymentProviderEvents.id, event.id));
          }
        } else {
          const callbackRefundMinor = this.providerAmountMinor(payload.refund_amount) ?? 0;
          if (callbackRefundMinor > Number(payment.refundedMinor)) {
            await tx.update(paymentProviderEvents).set({ processingError: "EXTERNAL_REFUND_REQUIRES_RECONCILIATION" }).where(eq(paymentProviderEvents.id, event.id));
          }
        }
      } else {
        await tx.update(payments).set({ ...paymentUpdates, status: payment.status === "FAILED" ? "PENDING" : payment.status } as any).where(eq(payments.id, payment.id));
      }

      await tx.update(paymentProviderEvents).set({ processedAt: new Date() }).where(eq(paymentProviderEvents.id, event.id));
      return { ok: true, status: providerStatus };
    });
  }

  async handleMonoWebhook(rawBody: Buffer | undefined, signature: string | undefined, body: Record<string, unknown>) {
    if (!rawBody?.length) {
      throw new BadRequestException({ code: "MONO_RAW_BODY_MISSING", message: "Monobank webhook raw body is required" });
    }
    await this.mono.verifyWebhook(rawBody, signature);

    const payload = body as MonoWebhookPayload;
    const invoiceId = String(payload.invoiceId ?? "").trim();
    if (!invoiceId) {
      throw new BadRequestException({ code: "MONO_INVOICE_ID_INVALID", message: "Monobank webhook invoiceId is required" });
    }
    const providerStatus = String(payload.status ?? "unknown").toLowerCase();
    const modifiedAt = payload.modifiedDate ? new Date(payload.modifiedDate) : null;
    if (!modifiedAt || Number.isNaN(modifiedAt.getTime())) {
      throw new BadRequestException({ code: "MONO_MODIFIED_DATE_INVALID", message: "Monobank webhook modifiedDate is invalid" });
    }

    // Signature verification happens first. Hash only the exact raw payload so a provider retry
    // remains idempotent even if ECDSA produces a different valid signature for the same body.
    const eventHash = createHash("sha256").update(rawBody).digest("hex");

    return this.db.transaction(async (tx) => {
      const [event] = await tx.insert(paymentProviderEvents).values({
        provider: this.mono.providerName,
        eventHash,
        orderId: null,
        providerPaymentId: invoiceId,
        providerStatus,
        providerUpdatedAt: modifiedAt,
        payload,
      }).onConflictDoNothing({ target: [paymentProviderEvents.provider, paymentProviderEvents.eventHash] }).returning();

      if (!event) return { ok: true, duplicate: true };

      const locked = await tx.execute(sql`
        SELECT
          p.id AS payment_id, p.status AS payment_status, p.refunded_minor, p.provider_updated_at,
          o.id AS order_id, o.status AS order_status, o.currency, o.total_minor, o.created_by,
          lci.id AS checkout_id, lci.enrollment_id, lci.subject_price_version_id,
          lci.lesson_units, lci.credits_to_grant, lci.base_unit_price_minor, lci.final_total_minor
        FROM payments p
        JOIN orders o ON o.id=p.order_id
        JOIN lesson_checkout_intents lci ON lci.order_id=o.id
        WHERE p.provider=${this.mono.providerName} AND p.provider_payment_id=${invoiceId}
        LIMIT 1
        FOR UPDATE OF p,o
      `);
      if (!locked.rowCount) {
        await tx.update(paymentProviderEvents).set({
          processedAt: new Date(),
          processingError: "PAYMENT_NOT_FOUND",
        }).where(eq(paymentProviderEvents.id, event.id));
        return { ok: true, ignored: true, reason: "PAYMENT_NOT_FOUND" };
      }

      const row = locked.rows[0] as any;
      await tx.update(paymentProviderEvents).set({ orderId: row.order_id }).where(eq(paymentProviderEvents.id, event.id));
      if (payload.reference && String(payload.reference) !== String(row.order_id)) {
        await tx.update(paymentProviderEvents).set({
          processedAt: new Date(),
          processingError: "PAYMENT_REFERENCE_MISMATCH",
        }).where(eq(paymentProviderEvents.id, event.id));
        return { ok: true, ignored: true, reason: "PAYMENT_REFERENCE_MISMATCH" };
      }

      const previousProviderUpdatedAt = row.provider_updated_at ? new Date(row.provider_updated_at) : null;
      if (previousProviderUpdatedAt && previousProviderUpdatedAt.getTime() > modifiedAt.getTime()) {
        await tx.update(paymentProviderEvents).set({
          processedAt: new Date(),
          processingError: "STALE_PROVIDER_EVENT",
        }).where(eq(paymentProviderEvents.id, event.id));
        return { ok: true, ignored: true, reason: "STALE_PROVIDER_EVENT" };
      }

      const paymentMethod = this.paymentMethodFromProvider(payload.paymentInfo?.paymentMethod);
      await tx.update(payments).set({
        providerStatus,
        providerUpdatedAt: modifiedAt,
        method: paymentMethod,
      }).where(eq(payments.id, row.payment_id));

      const pendingRefund = await tx.execute(sql`
        SELECT id, amount_minor, idempotency_key
        FROM payment_refunds
        WHERE payment_id=${row.payment_id} AND status='PENDING'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE
      `);
      const originalAmountMinor = Number(payload.amount ?? row.total_minor);
      const finalAmountMinor = payload.finalAmount == null ? null : Number(payload.finalAmount);
      const cumulativeRefundMinor = finalAmountMinor == null || !Number.isFinite(finalAmountMinor)
        ? null
        : Math.max(0, originalAmountMinor - finalAmountMinor);
      const successfulCancels = (payload.cancelList ?? []).filter((item) => String(item.status ?? "").toLowerCase() === "success");

      if (pendingRefund.rowCount) {
        const pending = pendingRefund.rows[0] as any;
        const successfulCancel = successfulCancels.find((item) =>
          !pending.idempotency_key || item.extRef === pending.idempotency_key,
        );
        const expectedCumulative = Number(row.refunded_minor) + Number(pending.amount_minor);
        const refundConfirmed = Boolean(successfulCancel)
          || providerStatus === "reversed"
          || cumulativeRefundMinor === expectedCumulative;

        if (refundConfirmed) {
          await this.finalizeRefundInTransaction(tx, pending.id, {
            ...payload,
            provider_refund_id: successfulCancel?.extRef ?? successfulCancel?.rrn ?? pending.idempotency_key ?? invoiceId,
            monoCancel: successfulCancel ?? null,
          }, successfulCancel ? "refund_success" : providerStatus);
        } else if (successfulCancels.length || (cumulativeRefundMinor != null && cumulativeRefundMinor > Number(row.refunded_minor))) {
          await tx.update(paymentProviderEvents).set({
            processedAt: new Date(),
            processingError: "REFUND_REQUIRES_RECONCILIATION",
          }).where(eq(paymentProviderEvents.id, event.id));
          return { ok: true, ignored: true, reason: "REFUND_REQUIRES_RECONCILIATION" };
        }
      } else if (successfulCancels.length || (cumulativeRefundMinor != null && cumulativeRefundMinor > Number(row.refunded_minor))) {
        await tx.update(paymentProviderEvents).set({
          processedAt: new Date(),
          processingError: "EXTERNAL_REFUND_REQUIRES_RECONCILIATION",
        }).where(eq(paymentProviderEvents.id, event.id));
        return { ok: true, ignored: true, reason: "EXTERNAL_REFUND_REQUIRES_RECONCILIATION" };
      }

      if (providerStatus === "success") {
        if (row.order_status === "CANCELLED") {
          await tx.update(paymentProviderEvents).set({
            processedAt: new Date(),
            processingError: "PAYMENT_FOR_CANCELLED_ORDER_REQUIRES_RECONCILIATION",
          }).where(eq(paymentProviderEvents.id, event.id));
          return { ok: true, ignored: true, reason: "PAYMENT_FOR_CANCELLED_ORDER_REQUIRES_RECONCILIATION" };
        }
        const callbackAmountMinor = Number(payload.amount);
        const callbackCurrency = Number(payload.ccy);
        const expectedCurrency = String(row.currency).toUpperCase() === "UAH" ? 980 : null;
        if (!Number.isInteger(callbackAmountMinor) || callbackAmountMinor !== Number(row.total_minor) || callbackCurrency !== expectedCurrency) {
          await tx.update(paymentProviderEvents).set({
            processedAt: new Date(),
            processingError: "PAYMENT_AMOUNT_OR_CURRENCY_MISMATCH",
          }).where(eq(paymentProviderEvents.id, event.id));
          return { ok: true, ignored: true, reason: "PAYMENT_AMOUNT_OR_CURRENCY_MISMATCH" };
        }

        const refreshedOrder = await tx.execute(sql`SELECT status FROM orders WHERE id=${row.order_id} LIMIT 1`);
        const currentOrderStatus = String((refreshedOrder.rows[0] as any)?.status ?? row.order_status);
        const refreshedPayment = await tx.execute(sql`SELECT status FROM payments WHERE id=${row.payment_id} LIMIT 1`);
        const currentPaymentStatus = String((refreshedPayment.rows[0] as any)?.status ?? row.payment_status);
        if (!["PARTIALLY_REFUNDED", "REFUNDED"].includes(currentOrderStatus)
          && !["PARTIALLY_REFUNDED", "REFUNDED"].includes(currentPaymentStatus)) {
          await this.finalizeSuccessfulOnlinePayment(tx, row, row.payment_id, payload as Record<string, unknown>, this.mono.providerName);
        }
      } else if (["failure", "expired"].includes(providerStatus)) {
        if (!["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(String(row.payment_status))) {
          await tx.update(payments).set({ status: "FAILED" }).where(eq(payments.id, row.payment_id));
        }
      }

      await tx.update(paymentProviderEvents).set({ processedAt: new Date() }).where(eq(paymentProviderEvents.id, event.id));
      return { ok: true, status: providerStatus };
    });
  }

  async refundOnlinePayment(orderId: string, dto: RefundPaymentDto, actor: AuthUser, requestId?: string) {
    const creditsToRevoke = Math.round(dto.lessonUnits * 2);
    if (!Number.isInteger(dto.lessonUnits * 2) || creditsToRevoke <= 0) {
      throw new BadRequestException({
        code: "REFUND_LESSON_UNITS_INVALID",
        message: "Refund lesson units must use 0.5 increments",
      });
    }

    const prepared = await this.db.transaction(async (tx) => {
      if (dto.idempotencyKey) {
        const reused = await tx.execute(sql`
          SELECT pr.*, p.order_id
          FROM payment_refunds pr
          JOIN payments p ON p.id=pr.payment_id
          WHERE pr.idempotency_key=${dto.idempotencyKey}
          LIMIT 1
        `);
        if (reused.rowCount) {
          const row = reused.rows[0] as any;
          if (row.order_id !== orderId) {
            throw new ConflictException({ code: "REFUND_IDEMPOTENCY_CONFLICT", message: "Refund idempotency key belongs to another order" });
          }
          return { reused: true as const, refund: row };
        }
      }

      const locked = await tx.execute(sql`
        SELECT
          o.id AS order_id, o.status AS order_status, o.created_by,
          p.id AS payment_id, p.amount_minor, p.refunded_minor, p.status AS payment_status,
          p.provider, p.provider_payment_id,
          lt.id AS topup_id, lt.enrollment_id, lt.credits_granted,
          g.id AS grant_id,
          (
            g.credits_granted
            - COALESCE((SELECT SUM(a.credits) FROM lesson_credit_allocations a WHERE a.grant_id=g.id), 0)
          )::int AS remaining_grant_credits
        FROM orders o
        JOIN payments p ON p.order_id=o.id AND p.provider IN ('LIQPAY','MONO')
        JOIN lesson_topups lt ON lt.order_id=o.id
        JOIN lesson_credit_grants g ON g.lesson_topup_id=lt.id AND g.type='PURCHASE'
        WHERE o.id=${orderId}
        ORDER BY p.paid_at DESC NULLS LAST, p.created_at DESC
        LIMIT 1
        FOR UPDATE OF o,p
      `);
      if (!locked.rowCount) {
        throw new NotFoundException({ code: "ONLINE_PAYMENT_NOT_FOUND", message: "Successful online lesson payment not found" });
      }
      const row = locked.rows[0] as any;
      if (!["PAID", "PARTIALLY_REFUNDED"].includes(row.order_status) || !["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(row.payment_status)) {
        throw new ConflictException({ code: "PAYMENT_NOT_REFUNDABLE", message: "Only a successful online payment can be refunded" });
      }

      const pending = await tx.execute(sql`SELECT id FROM payment_refunds WHERE payment_id=${row.payment_id} AND status='PENDING' LIMIT 1`);
      if (pending.rowCount) {
        throw new ConflictException({ code: "REFUND_ALREADY_PENDING", message: "Another refund for this payment is still pending" });
      }

      if (creditsToRevoke > Number(row.remaining_grant_credits)) {
        throw new ConflictException({
          code: "REFUND_CREDITS_ALREADY_USED",
          message: "Cannot refund lessons that have already been consumed or transferred",
          details: { refundableLessonUnits: Number(row.remaining_grant_credits) / 2 },
        });
      }

      const succeeded = await tx.execute(sql`
        SELECT COALESCE(SUM(credits_to_revoke),0)::int AS credits
        FROM payment_refunds
        WHERE payment_id=${row.payment_id} AND status='SUCCEEDED'
      `);
      const alreadyRefundedCredits = Number((succeeded.rows[0] as any).credits);
      const cumulativeCredits = alreadyRefundedCredits + creditsToRevoke;
      if (cumulativeCredits > Number(row.credits_granted)) {
        throw new ConflictException({ code: "REFUND_EXCEEDS_PURCHASE", message: "Refund exceeds purchased lesson credits" });
      }

      const targetRefundedMinor = Math.round(Number(row.amount_minor) * cumulativeCredits / Number(row.credits_granted));
      const amountMinor = targetRefundedMinor - Number(row.refunded_minor);
      if (amountMinor <= 0) {
        throw new ConflictException({ code: "REFUND_AMOUNT_INVALID", message: "Calculated refund amount is not positive" });
      }

      const [refund] = await tx.insert(paymentRefunds).values({
        paymentId: row.payment_id,
        amountMinor,
        creditsToRevoke,
        provider: row.provider,
        idempotencyKey: dto.idempotencyKey,
        reason: dto.reason,
        requestedBy: actor.id,
      }).returning();

      await this.audit.record({
        actorUserId: actor.id,
        actorRoleCode: actor.roles[0],
        action: "REQUEST_ONLINE_PAYMENT_REFUND",
        entityType: "PaymentRefund",
        entityId: refund.id,
        requestId,
        afterData: { orderId, provider: row.provider, amountMinor, lessonUnits: dto.lessonUnits, creditsToRevoke, reason: dto.reason },
      }, tx as any);

      return { reused: false as const, refund, order: row };
    });

    if (prepared.reused) return { refund: prepared.refund, reused: true };

    const provider = this.paymentProviders.resolve(prepared.order.provider);
    let providerResponse: Record<string, unknown>;
    try {
      providerResponse = await provider.refund({
        orderId,
        providerPaymentId: prepared.order.provider_payment_id,
        amountMinor: prepared.refund.amountMinor,
        idempotencyKey: prepared.refund.idempotencyKey,
        description: dto.reason || `Math School refund · ${dto.lessonUnits} lessons`,
      });
    } catch (error) {
      await this.db.update(paymentRefunds).set({
        providerStatus: "transport_unknown",
        providerResponse: { error: error instanceof Error ? error.message : String(error) },
        updatedAt: new Date(),
      }).where(and(eq(paymentRefunds.id, prepared.refund.id), eq(paymentRefunds.status, "PENDING")));
      const [current] = await this.db.select().from(paymentRefunds).where(eq(paymentRefunds.id, prepared.refund.id)).limit(1);
      if (current?.status === "SUCCEEDED") return { refund: current, reused: false, provider: { result: "callback_confirmed" } };
      throw error;
    }

    const providerStatus = String(providerResponse.status ?? providerResponse.result ?? "unknown").toLowerCase();
    const failed = provider.providerName === "LIQPAY"
      ? providerResponse.result === "error" || ["error", "failure"].includes(providerStatus)
      : providerStatus === "failure";
    const succeeded = provider.providerName === "LIQPAY"
      ? providerResponse.result === "ok" && providerStatus === "reversed"
      : providerStatus === "success";
    const providerRefundId = provider.providerName === "LIQPAY"
      ? (providerResponse.payment_id == null ? null : String(providerResponse.payment_id))
      : (prepared.refund.idempotencyKey ?? null);

    if (failed) {
      await this.db.update(paymentRefunds).set({
        status: "FAILED",
        providerStatus,
        providerRefundId,
        providerResponse,
        updatedAt: new Date(),
        completedAt: new Date(),
      }).where(and(eq(paymentRefunds.id, prepared.refund.id), eq(paymentRefunds.status, "PENDING")));
      const [current] = await this.db.select().from(paymentRefunds).where(eq(paymentRefunds.id, prepared.refund.id)).limit(1);
      if (current?.status === "SUCCEEDED") return { refund: current, reused: false, provider: providerResponse };
      throw new BadGatewayException({
        code: "PAYMENT_REFUND_REJECTED",
        message: `${provider.providerName} rejected the refund`,
        details: providerResponse,
      });
    }

    if (succeeded) {
      const finalized = await this.db.transaction((tx) =>
        this.finalizeRefundInTransaction(tx, prepared.refund.id, {
          ...providerResponse,
          provider_refund_id: providerRefundId,
        }, providerStatus),
      );
      return { refund: finalized, provider: providerResponse, reused: false };
    }

    await this.db.update(paymentRefunds).set({
      providerStatus,
      providerRefundId,
      providerResponse,
      updatedAt: new Date(),
    }).where(eq(paymentRefunds.id, prepared.refund.id));
    return { refund: { ...prepared.refund, providerStatus }, provider: providerResponse, reused: false };
  }

  private async finalizeSuccessfulOnlinePayment(
    tx: any,
    row: any,
    paymentId: string,
    payload: Record<string, unknown>,
    providerName: PaymentProviderName,
  ) {
    const now = new Date();
    const providerPaymentId = providerName === "MONO"
      ? (payload.invoiceId == null ? null : String(payload.invoiceId))
      : (payload.payment_id == null ? null : String(payload.payment_id));
    const providerMethod = providerName === "MONO"
      ? (payload.paymentInfo as Record<string, unknown> | undefined)?.paymentMethod
      : payload.paytype;
    const providerUpdatedAt = providerName === "MONO" && payload.modifiedDate
      ? new Date(String(payload.modifiedDate))
      : undefined;
    const existingTopup = await tx.execute(sql`SELECT id FROM lesson_topups WHERE order_id=${row.order_id} LIMIT 1`);

    await tx.update(payments).set({
      status: "SUCCEEDED",
      method: this.paymentMethodFromProvider(providerMethod),
      providerPaymentId,
      providerStatus: String(payload.status ?? "success"),
      ...(providerUpdatedAt && !Number.isNaN(providerUpdatedAt.getTime()) ? { providerUpdatedAt } : {}),
      paidAt: now,
    }).where(eq(payments.id, paymentId));

    await tx.update(orders).set({ status: "PAID", paidAt: now }).where(eq(orders.id, row.order_id));

    let topupId: string;
    if (existingTopup.rowCount) {
      topupId = String((existingTopup.rows[0] as any).id);
    } else {
      const [topup] = await tx.insert(lessonTopups).values({
        orderId: row.order_id,
        enrollmentId: row.enrollment_id,
        subjectPriceVersionId: row.subject_price_version_id,
        lessonUnits: Number(row.lesson_units),
        creditsGranted: Number(row.credits_to_grant),
        baseUnitPriceMinor: Number(row.base_unit_price_minor),
        finalTotalMinor: Number(row.final_total_minor),
      }).returning({ id: lessonTopups.id });
      topupId = topup.id;
    }

    await tx.insert(lessonCreditGrants).values({
      enrollmentId: row.enrollment_id,
      type: "PURCHASE",
      creditsGranted: Number(row.credits_to_grant),
      lessonTopupId: topupId,
      createdBy: row.created_by,
    }).onConflictDoNothing({ target: lessonCreditGrants.lessonTopupId });

    await this.fundingMaterializer.refreshEnrollment(row.enrollment_id, row.created_by, tx);
    await this.audit.record({
      actorRoleCode: "SYSTEM",
      action: "ONLINE_PAYMENT_CONFIRMED",
      entityType: "Order",
      entityId: row.order_id,
      afterData: {
        provider: providerName,
        providerPaymentId,
        amountMinor: Number(row.total_minor),
        creditsGranted: Number(row.credits_to_grant),
      },
    }, tx as any);
  }

  private async finalizeRefundInTransaction(tx: any, refundId: string, providerResponse: Record<string, unknown>, providerStatus: string) {
    const result = await tx.execute(sql`
      SELECT
        pr.id, pr.status, pr.amount_minor, pr.credits_to_revoke, pr.requested_by, pr.provider,
        p.id AS payment_id, p.order_id, p.amount_minor AS payment_amount_minor, p.refunded_minor,
        lt.id AS topup_id, lt.enrollment_id,
        g.id AS grant_id,
        (
          g.credits_granted
          - COALESCE((SELECT SUM(a.credits) FROM lesson_credit_allocations a WHERE a.grant_id=g.id),0)
        )::int AS remaining_grant_credits,
        o.created_by
      FROM payment_refunds pr
      JOIN payments p ON p.id=pr.payment_id
      JOIN orders o ON o.id=p.order_id
      JOIN lesson_topups lt ON lt.order_id=o.id
      JOIN lesson_credit_grants g ON g.lesson_topup_id=lt.id AND g.type='PURCHASE'
      WHERE pr.id=${refundId}
      FOR UPDATE OF pr,p,o
    `);
    if (!result.rowCount) throw new NotFoundException({ code: "REFUND_NOT_FOUND", message: "Refund not found" });
    const row = result.rows[0] as any;
    if (row.status === "SUCCEEDED") return row;
    if (row.status === "FAILED") throw new ConflictException({ code: "REFUND_ALREADY_FAILED", message: "Failed refund cannot be finalized" });
    if (Number(row.remaining_grant_credits) < Number(row.credits_to_revoke)) {
      throw new ConflictException({ code: "REFUND_CREDITS_ALREADY_USED", message: "Refundable credits were consumed before the refund completed" });
    }

    const [debit] = await tx.insert(lessonCreditDebits).values({
      enrollmentId: row.enrollment_id,
      type: "PURCHASE_REFUND",
      creditsDebited: Number(row.credits_to_revoke),
      createdBy: row.requested_by ?? row.created_by,
    }).returning({ id: lessonCreditDebits.id });
    await tx.insert(lessonCreditAllocations).values({
      debitId: debit.id,
      grantId: row.grant_id,
      credits: Number(row.credits_to_revoke),
    });

    const newRefundedMinor = Number(row.refunded_minor) + Number(row.amount_minor);
    const fullyRefunded = newRefundedMinor >= Number(row.payment_amount_minor);
    await tx.update(paymentRefunds).set({
      status: "SUCCEEDED",
      providerStatus,
      providerRefundId: providerResponse.provider_refund_id != null
        ? String(providerResponse.provider_refund_id)
        : providerResponse.payment_id == null ? null : String(providerResponse.payment_id),
      providerResponse,
      updatedAt: new Date(),
      completedAt: new Date(),
    }).where(eq(paymentRefunds.id, refundId));
    await tx.update(payments).set({
      status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED",
      refundedMinor: newRefundedMinor,
      providerStatus,
    }).where(eq(payments.id, row.payment_id));
    await tx.update(orders).set({ status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED" }).where(eq(orders.id, row.order_id));

    await this.fundingMaterializer.refreshEnrollment(row.enrollment_id, row.requested_by ?? row.created_by, tx);
    await this.audit.record({
      actorUserId: row.requested_by ?? undefined,
      actorRoleCode: row.requested_by ? undefined : "SYSTEM",
      action: "ONLINE_PAYMENT_REFUNDED",
      entityType: "PaymentRefund",
      entityId: refundId,
      afterData: {
        orderId: row.order_id,
        provider: row.provider,
        amountMinor: Number(row.amount_minor),
        creditsRevoked: Number(row.credits_to_revoke),
        fullyRefunded,
      },
    }, tx as any);

    return {
      id: refundId,
      status: "SUCCEEDED",
      amountMinor: Number(row.amount_minor),
      creditsRevoked: Number(row.credits_to_revoke),
      orderStatus: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED",
    };
  }

  private providerAmountMinor(value: unknown) {
    if (value === undefined || value === null || value === "") return null;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return null;
    return Math.round(amount * 100);
  }

  private paymentMethodFromProvider(paytype: unknown): "CARD" | "BANK_TRANSFER" | "CASH" | "OTHER" {
    const value = String(paytype ?? "").toLowerCase();
    if (["card", "apay", "gpay", "privat24", "masterpass", "moment_part", "paypart", "pan", "apple", "google", "monobank", "wallet", "direct"].includes(value)) return "CARD";
    if (value === "cash") return "CASH";
    if (value === "invoice") return "BANK_TRANSFER";
    return "OTHER";
  }

  private async assertCanViewEnrollmentBalance(enrollmentId: string, actor: AuthUser) {
    if (actor.roles.some((role) => PRIVILEGED_ROLES.has(role))) return;

    const result = await this.db.execute(sql`
      SELECT
        s.user_id AS student_user_id,
        pp.user_id AS parent_user_id,
        ta.teacher_id
      FROM student_subject_enrollments e
      JOIN students s ON s.id = e.student_id
      LEFT JOIN parent_profiles pp ON pp.family_id = s.family_id
      LEFT JOIN teacher_assignments ta ON ta.enrollment_id = e.id AND ta.ended_at IS NULL
      WHERE e.id = ${enrollmentId}
      LIMIT 1
    `);
    if (!result.rowCount) throw new NotFoundException({ code: "ENROLLMENT_NOT_FOUND", message: "Enrollment not found" });

    const row = result.rows[0] as { student_user_id: string | null; parent_user_id: string | null; teacher_id: string | null };
    if (row.student_user_id === actor.id || row.parent_user_id === actor.id || row.teacher_id === actor.id) return;

    throw new ForbiddenException({ code: "BALANCE_SCOPE_DENIED", message: "You cannot view this lesson balance" });
  }
}
