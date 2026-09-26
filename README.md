# School Platform

Subject-agnostic operating platform for an online school.

## Current status

**v33 Release Candidate dependency/image provenance hardening** is in the repository.

Implemented so far:

- NestJS API bootstrap
- PostgreSQL/Drizzle database package
- raw SQL migration runner with migration checksums
- migrations `0001`–`0054`
- users, roles, permissions and scope-aware temporary grants
- opaque server-side sessions in HttpOnly cookies
- Argon2id password verification
- families, one parent account per family and optional student accounts
- staff profiles and primary-manager history
- subjects and versioned subject pricing
- teacher profiles, teacher/subject capability and versioned teacher rates
- one student/subject enrollment and one active primary teacher
- School Year / Summer teacher availability
- one-off availability exceptions, vacation requests, staff approval and affected-lesson operations
- versioned regular schedules
- PostgreSQL teacher/student calendar overlap protection
- reschedule history, parent two-hour cutoff, free-slot search and move-to-end handling
- **integer lesson-credit ledger (`60m = 2`, `30m = 1`)**
- manual manager top-ups with immutable money/price snapshots
- balance-backed future-session funding
- **14-calendar-day `BOOKED` tail after the paid horizon**
- `BOOKED` lessons cannot be marked conducted
- regular lesson marking with topic + homework flag
- teacher 48-hour marking window; privileged staff override after expiry
- credit debit/allocation on lesson completion
- immutable teacher payroll accruals with 14-day settlement periods and 3-day payout windows
- first and second student no-show policy with semantic `CHARGED_NO_SHOW`
- teacher late-cancellation strikes and culprit-bound compensation credits
- 15-minute teacher wait before recording a student no-show
- duplicate-incident protection per scheduled occurrence
- family lesson-balance transfer between children for the same subject
- balance freeze (`PAUSED`) and ledger-preserving write-off (`INACTIVE`)
- first-lesson creation as a 60-minute calendar reservation
- first-lesson payment snapshot and pre-start payment deadline
- mandatory initial first-lesson progress report
- fixed first-lesson teacher payroll accrual independent of customer discounts
- shared student/subject journal derived from completed sessions
- global Admin/Manager calendar filters and mobile Day/long-Week calendar UX
- structured calendar action forms for marking, incidents and rescheduling
- substitute-teacher candidate search by subject + real availability + conflicts
- substitute assignment preserving primary teacher and switching actual teacher/Zoom
- Manager/Admin vacation operations queue with per-lesson substitute or move-to-end resolution
- parent/student portal foundations, progress-report requests and visibility controls
- Telegram notification preferences, linking and transactional outbox delivery foundation
- `SUBSTITUTE_ASSIGNED` notification event
- durable one-hour lesson reminders for parents/students with reschedule-safe deduplication
- next-local-day unmarked-lesson reminders that expire with the 48-hour marking window
- low/zero-balance notifications once per balance cycle
- stale-notification cancellation, preference-aware skips and Telegram exponential retry/backoff
- interrupted `PROCESSING` notification recovery
- transactional audit writes
- transactional outbox foundation
- request IDs
- Redis/PostgreSQL local Docker configuration
- Admin school-state dashboard with operational, learning, payroll-window and financial-control metrics
- bounded period analytics for revenue, teacher accruals, lesson activity and revenue breakdowns
- typed/validated school settings UI with per-setting audit history
- core scheduling/lesson policy settings wired into runtime rules (reservation tail, parent cutoff, mark deadline, no-show wait, strike reset, seasons, first-lesson teacher pay)
- multi-provider parent checkout with Monobank acquiring + LiqPay, provider-bound orders and signed server callbacks
- idempotent payment-provider event ledger and one-time online credit materialization
- partial/full online refunds limited to unused purchase credits
- refund-aware net revenue analytics and parent/manager payment UI
- CI LiqPay + Monobank HTTP mocks covering checkout, callback idempotency, out-of-order Mono events and partial refunds
- PostgreSQL-backed distributed rate limiting for login/MFA/payment/Telegram public attack surfaces
- strict mutating-request origin validation plus explicit CORS allow-list support
- API + web security headers, CSP and production HSTS
- structured JSON request/error logs with request-id correlation, redaction and hashed client identifiers
- Prometheus-compatible protected metrics endpoint plus separate liveness/readiness health checks
- vendor-neutral redacted error-reporting webhook hook
- PostgreSQL backup/checksum/verify/restore scripts with destructive production restore gates
- CI backup/restore drill and production security smoke gate
- staging Docker definitions with frozen-lockfile release images
- DB-backed worker heartbeat and API/worker release-SHA parity smoke gate
- release preflight + reproducible release manifest tooling
- networked dependency-bootstrap workflow that generates a reviewable `pnpm-lock.yaml` bundle and proves a frozen install
- dependency security audit + resolved dependency-tree evidence bound to `RELEASE_SHA` and lockfile SHA-256
- staging environment preflight for HTTPS host consistency, non-placeholder secrets and safe E2E flags
- OCI revision labels on API/Web/Worker release images plus Docker image evidence
- final release verifier binding source manifest, acceptance, dependency audit/tree and all three release images

## Important M1 invariant

Customer money, student lesson entitlement and teacher earnings are three different systems:

```text
Orders / Payments
       ↓
Lesson credit grants / debits / reservations
       ↓
LiveSession completion
       ↓
Payroll accrual
```

Changing a customer price never rewrites old purchases. Changing a teacher rate never rewrites old accruals.

## Apps

- `apps/web` — Next.js web application with Admin/Manager/Teacher/Parent/Student/Financier foundations and calendar UI
- `apps/api` — NestJS API
- `apps/worker` — background worker bootstrap

## Packages

- `packages/db` — PostgreSQL schema, migrations and seeds
- `packages/contracts` — shared API contracts
- `packages/ui` — shared UI components
- `packages/config` — shared configuration
- `packages/utils` — shared utilities

## Local setup

PDF course processing requires Poppler's `pdftoppm` binary on the machine that runs `@school/worker`. The production worker image installs `poppler-utils`; for local development, install Poppler for your OS and ensure `pdftoppm` is available on `PATH` before starting the worker.

Verify:

```bash
pdftoppm -v
```

Then start the platform:

```bash
cp .env.example .env
docker compose up -d postgres redis
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Health check:

```text
GET http://localhost:3001/api/health
```

## Development data

The seed can create Admin, Manager, Mathematics, an active demo teacher, teacher availability and an initial teacher rate. M1 also seeds a Mathematics customer price when `SEED_DEVELOPMENT_DATA=true` and Admin credentials are configured.

Money values use minor units. For example:

```text
40000 = 400.00 UAH
15000 = 150.00 UAH
```

## Core Scheduling API

```text
PUT /api/teachers/:teacherId/availability
GET /api/teachers/:teacherId/availability

PUT /api/enrollments/:enrollmentId/schedule
GET /api/enrollments/:enrollmentId/schedule

GET /api/calendar?from=2026-09-21&to=2026-09-27
POST /api/sessions/:sessionId/reschedule
```

A new regular schedule is no longer materialized as fake `PAID` lessons. The funding materializer uses the actual credit balance and then keeps two calendar weeks of `BOOKED` occurrences.

## M1 Billing API

Create/schedule a subject price (Admin by default):

```text
POST /api/subjects/:subjectId/prices
```

```json
{
  "regular60PriceMinor": 40000,
  "firstLessonPriceMinor": 15000,
  "currency": "UAH",
  "effectiveFrom": "2026-09-01"
}
```

Read the effective price:

```text
GET /api/subjects/:subjectId/prices/current
```

Record a manual manager top-up. Manager-entered purchases may be fewer than 10 lesson units; the future parent checkout will enforce the 10-unit online minimum separately.

```text
POST /api/enrollments/:enrollmentId/topups/manual
```

```json
{
  "lessonUnits": 10,
  "amountMinor": 400000,
  "paymentMethod": "BANK_TRANSFER"
}
```

Read the lesson balance without exposing customer financial history:

```text
GET /api/enrollments/:enrollmentId/balance
```

Example conceptually:

```json
{
  "balanceCredits": 20,
  "balanceLessonUnits": 10,
  "reservedCredits": 20,
  "reservedLessonUnits": 10
}
```

## Lesson completion and journal

Teacher marks a paid regular lesson:

```text
POST /api/sessions/:sessionId/mark
```

```json
{
  "topicTitle": "Квадратні рівняння",
  "homeworkAssigned": true
}
```

This single database transaction completes the lesson, consumes its credit reservation, records the debit/allocation, creates the teacher payroll accrual, updates clean-streak state and writes the audit entry.

Journal:

```text
GET /api/enrollments/:enrollmentId/journal
```

The journal contains only actually completed lessons. A future paid no-show status will remain semantically separate and will not be faked as a completed lesson.

## Current vertical flow

```text
Admin configures subject price
        ↓
Manager creates family/student/enrollment
        ↓
Manager assigns teacher + regular schedule
        ↓
0 balance -> only 14-day BOOKED tail
        ↓
Manager records lesson purchase
        ↓
future occurrences become PAID as credits cover them
        ↓
after last PAID -> 14-day BOOKED tail
        ↓
Teacher conducts lesson
        ↓
Teacher marks topic + homework within 48h
        ↓
credit debit + journal + payroll accrual
```

## M1.4 calendar filters and safe rescheduling

Global school calendars now expose teacher, student, subject, primary-manager, lesson-type and funding-status filters. Filter dictionaries are loaded from:

```text
GET /api/calendar/filter-options
```

Lesson movement no longer requires typing an arbitrary timestamp in the web UI. The available options come from:

```text
GET /api/sessions/:sessionId/free-slots?days=14
```

The endpoint combines seasonal teacher availability, one-off exceptions, approved vacations and existing teacher/student sessions. Parents remain subject to the two-hour self-reschedule cutoff.

Regular lessons can also be moved to the end of the current planned sequence:

```json
{
  "mode": "END_OF_PAID_SEQUENCE",
  "reason": "TEACHER_PERSONAL"
}
```

The server chooses the destination. Parents do not receive this action.

Architecture notes:

- `docs/architecture/0008-calendar-action-ui.md`
- `docs/architecture/0009-calendar-filters-free-slots.md`


## M1.5 vacations and substitute teachers

Teacher vacation requests now have an operational queue for Manager/Admin:

```text
/manager/vacations
/admin/vacations
```

Staff can approve or reject a request, see every still-unresolved scheduled lesson inside the approved vacation, and resolve each lesson by assigning an actually available substitute or, for a regular lesson, moving it to the end of the planned paid sequence.

Substitute candidates come from:

```text
GET /api/sessions/:sessionId/substitute-candidates
```

The server filters candidates by active subject assignment, seasonal availability, one-off exceptions, approved vacations and conflicting lessons. `primary_teacher_id` is preserved while `actual_teacher_id` changes, so the shared journal and substitute Zoom link continue to work correctly.

Vacation operations API:

```text
GET   /api/teachers/vacations?status=OPEN
GET   /api/teachers/vacations/:vacationId
PATCH /api/teachers/vacations/:vacationId/review
```

The teacher vacation page also uses a structured request form instead of browser prompts.

Architecture note:

- `docs/architecture/0010-vacations-substitutes.md`

## M1.6 reminder automation and notification lifecycle

Timed notifications are now planned durably in PostgreSQL instead of relying on a narrow polling window. Lesson reminders are reschedule-safe, unmarked-lesson reminders follow the school timezone and marking deadline, and low/zero-balance messages are deduplicated by balance cycle.

Telegram delivery now has exponential retry/backoff, terminal failure handling, stale-message cancellation, preference-aware `SKIPPED` history and recovery of interrupted `PROCESSING` rows.

Configurable worker settings include lesson-reminder lead time, planning horizon, local reminder hour, retry limits/backoff and school timezone.

Architecture note:

- `docs/architecture/0011-reminder-lifecycle.md`

## M1.7 role-aware Telegram controls and notification history

The profile page now exposes the existing notification engine as a proper user-facing settings flow. Telegram connection state is visible, linking uses the short-lived bot deep link and polls for confirmation, and disconnecting the bot preserves notification history.

Notification preferences are role-aware through `notification_event_roles`, so parents do not see teacher-only events, students do not see finance alerts, and teachers only see operational events relevant to teaching. Mandatory security events remain non-configurable.

The UI currently exposes Telegram switches only; email remains reserved for account/security flows until an email delivery worker is implemented. The same page also shows the latest durable platform notifications, unread state, deep links back into the product, and a bulk “read all” action.

Architecture note:

- `docs/architecture/0012-notification-preferences-ui.md`

## M1.8 teacher students, shared journal and report actions

The teacher cabinet now has a dedicated student workflow instead of reusing the manager operational table. `My students` shows regular active/archive relationships, subject schedules and remaining lesson units, while the detail page exposes parent contact, the teacher-related enrollments and the shared learning journal.

The shared journal preserves continuity across substitutions: the current primary teacher sees substitute-conducted entries, substitutes/former teachers only see lessons they personally conducted when they are no longer the primary teacher, and the UI adds `Провів: ...` only on actual substitute entries. Teacher enrollment APIs are now enrollment-scoped to avoid leaking unrelated subjects for the same student.

Pending parent-requested progress reports are visible and completable directly from the teacher student page.

Architecture note:

- `docs/architecture/0013-teacher-students-journal.md`

## M1.9 parent family learning hub

The parent `Навчання` page is now a single family learning workspace. Every child is grouped by subject with teacher, remaining lesson units, the latest journal entries, substitute attribution, report-request status and completed reports in the same context.

Report-request eligibility is now server-driven through:

```text
GET /api/students/:studentId/reports/eligibility
```

The API reports `AVAILABLE`, `PENDING`, `TOO_EARLY`, `INACTIVE` or `NO_TEACHER`, together with the completed/required lesson count and the pending target lesson where relevant. Both the eligibility query and the actual request command read `school_settings.report_request_min_lessons`, so changing the school rule no longer creates a mismatch between UI and backend validation.

Parents can choose whether a newly requested report should be visible to the student and can change the visibility of an already completed report later.

Architecture note:

- `docs/architecture/0014-parent-learning-hub.md`

## M1.10 student learning experience

The student cabinet now has a focused tutoring-learning view instead of a raw journal table. Each subject groups the remaining lesson balance, enrollment status, primary teacher contact, nearest scheduled lesson, the shared journal and progress reports in one place.

The nearest lesson uses the actual teacher for that occurrence, so substitute lessons automatically expose the substitute teacher's Zoom/contact context while the subject card still preserves the primary teacher relationship. Active Telegram usernames are available as optional direct teacher contact metadata.

Student report privacy remains server-enforced: `GET /api/students/:studentId/reports` returns only reports with `visible_to_student = true` for a student actor. The UI never receives parent-hidden reports.

The student dashboard was also simplified around the nearest lesson and the three core destinations: `Розклад / Журнал / Курси`, with lesson balances but no prices, payments or manager contact information.

Architecture note:

- `docs/architecture/0015-student-learning-experience.md`

## M1.11 availability editor + teacher matching onboarding

Teacher availability is now handled through a reusable editor in both the teacher cabinet and the admin/manager teacher profile. The editor includes a weekly visual overview, multiple intervals per day, day-to-day copying, cross-season copying and one-off date exceptions that can be edited or removed.

Managers can now run a real schedule-based teacher match through `POST /api/teachers/match-schedule`. Matching distinguishes a seasonal full match from a partial match and separately surfaces temporary conflicts in the next 28 days (vacation, exception or an already scheduled lesson).

The new-student wizard now collects the desired regular schedule, runs the matcher, and can create the family, student, enrollment, teacher assignment and regular schedule in one onboarding flow when a full selectable match is chosen.

Architecture note:

- `docs/architecture/0016-availability-matching-onboarding.md`

## Next slice

The next larger slice should cover manager-side enrollment operations: safe primary-teacher changes against the current regular schedule, permanent schedule changes from the student card, subject pause/finish flows and the remaining family balance transfer/freeze controls in a single operational workspace.

## M1.12 manager student operations workspace

The manager/admin student card is now the operational control point for each subject enrollment rather than a read-only summary.

Available actions include:

- manual balance top-up with a structured form;
- permanent regular-schedule changes using versioned schedule history;
- safe primary-teacher changes that preserve the current schedule only when the replacement is actually available;
- pause/freeze with balance preservation;
- full finish/write-off through the lesson-credit ledger;
- reactivation of a paused/inactive subject;
- lesson-unit transfer to another child in the same family and same subject.

Primary-teacher changes use a dedicated scheduling command:

```text
POST /api/enrollments/:enrollmentId/change-primary-teacher
```

The backend validates the candidate against the active regular schedule, already materialized future sessions, availability exceptions, vacations and existing teacher conflicts. On success it closes the old teacher assignment, creates the new one, updates future primary-teacher references, preserves explicit substitute assignments, writes audit and sends role-aware notifications.

New notification event:

```text
PRIMARY_TEACHER_CHANGED
```

Architecture note:

- `docs/architecture/0017-student-management-operations.md`

## M1.13 family + student operational history

Manager/Admin/Support now have a traceable historical workspace rather than only the current student state. The student card includes primary-manager history, teacher-assignment history, versioned regular schedules, purchase/top-up snapshots, the lesson-credit ledger, cross-child transfers and related append-only audit events.

A consolidated family operations page is available from the student card and combines the single parent account, all children, primary managers, subject balances/current teachers, family purchase history, course licenses and recent significant activity. The family `ACTIVE/INACTIVE` state is derived from active tutoring enrollments or active non-expired course licenses rather than being manually edited.

Internal history endpoints explicitly reject teacher/parent/student actors even when they otherwise have student-view permissions, keeping operational/audit details inside the school team.

Architecture note:

- `docs/architecture/0018-family-student-history.md`

## M1.14 family/student lifecycle + CRM navigation

The manager/admin CRM surface now has a dedicated family index with search across parent/child names, phone and email, manager ownership filtering and explicit active/archive/all lifecycle views. The student list has matching lifecycle filters, and both lead directly into the existing operational cards.

Parent and student core profile data can now be edited from the operational UI with audit before/after snapshots. Parent and optional student account state is visible together with the latest invitation state; pending accounts can be invited or re-invited without exposing invitation tokens.

Archive/reactivate is now a separate lifecycle from tutoring enrollment status. A student cannot be archived while active tutoring or future scheduled lessons remain, and a family cannot be archived until every child is archived and active course access is finished. Archive operations revoke login sessions but preserve journals, balances, payments, payroll references and audit history.

Invitation delivery was also normalized so all invitation/password-reset outbox events match the email worker contract.

Architecture note:

- `docs/architecture/0019-family-student-lifecycle-crm.md`

## M1.15 teacher + staff lifecycle/admin workspace

Teacher and internal-team lifecycle management is now explicit rather than being spread across raw account actions. Admin/Support can edit operational teacher profile fields, activate/deactivate teaching subjects, re-send invitations, suspend/restore accounts and archive/reactivate teachers. Archiving is blocked while the teacher still owns active enrollments or future scheduled sessions, so historical data is never silently detached. Teachers can edit only their own contact/Zoom fields; subjects, start date and pay rates remain administrative.

The Admin `Команда` workspace now lists managers, financiers, support staff and the owner/Admin account with role/status/search filters, profile editing, invitation state, role changes and account lifecycle controls. Manager-role changes/archival are blocked until active primary-manager responsibilities are reassigned. Admin roles are protected from the operational role editor.

Teacher payout requisites are now exposed through a protected read/update flow. Full details remain encrypted at rest and are available only to the teacher themself, Admin or Financier according to payroll permissions; operational roles do not receive bank details. The teacher payout screen includes requisites plus a structured date-range statement, and the Admin teacher card includes payout history, accruals, availability, temporary grants and audit history.

The Drizzle payroll schema was brought back in sync with the existing payout-period/details/payout tables, and migration `0044` adds lifecycle lookup indexes.

Architecture note:

- `docs/architecture/0020-teacher-staff-lifecycle-admin.md`

## M1.16 payroll + financier hardening

Payroll is now safe for partially paid periods and late lesson marking. The default schedule is configurable through `school_settings` and follows the agreed 14-day calculation / 3-day payout rhythm. The payout window overlaps the next accrual period without stopping new earnings.

A payout moves through `PENDING -> READY -> PAID`. Missing payout requisites keep it `PENDING`; adding new requisites updates only unpaid payout snapshots. Once a payout is `PAID`, migration `0045` protects both the payout row and its item composition with PostgreSQL triggers, so historical paid sums cannot be silently recalculated.

Late accruals created after a teacher has already been paid remain unsettled and enter the next open calculation as a visible prior-period adjustment. Recalculation during a partially paying period cannot downgrade the period status or append new items to an already paid teacher payout.

The Financier workspace now includes search/status filters, missing-requisite alerts, adjustment totals, post-calculation change alerts, per-teacher payout breakdown and atomic bulk confirmation. A separate teacher CRM page exposes current teacher/subject rates read-only, payout destination status, unsettled accruals and the latest payout. Financier still cannot edit teacher rates.

Teacher payout UI now separates current 14-day earnings from pending historical corrections and keeps the arbitrary date-range statement.

Architecture note:

- `docs/architecture/0021-payroll-financier-hardening.md`

## Next slice

The next larger package should close course administration ergonomics: visual course/module/lesson builder, PDF asset flow, test/question authoring, access-plan and explanation-entitlement editing, family course grants and progress overview. After that we should run a full dependency install/build/test pass and fix integration drift before calling the first end-to-end beta build ready.

## M1.17 course builder + secure course content

The Admin course area is now a real visual builder rather than a prompt-based placeholder. Courses have editable metadata/cover, draggable module and lesson order, lesson publication controls, and a dedicated lesson builder with reorderable TEXT/PDF/TEST blocks. Access plans support duration or fixed expiry and can independently enable premium test explanations.

Test authoring now includes MINI and timed KNOWLEDGE_CHECK modes, configurable low-score thresholds, static questions, basic generated arithmetic/linear-equation templates, premium explanation content and subject-topic tagging for the personal error bank. Timed attempts are also enforced on the backend rather than only by the browser.

PDF course materials use an asynchronous private-asset flow. Upload stores the source PDF as `PROCESSING`, the worker consumes a `FILE_PROCESS_PDF` outbox event and uses Poppler `pdftoppm` to create private page-image assets. Students/parents receive only those page assets; the original PDF is denied outside course-management access. The lesson viewer renders the pages in-platform with a student watermark and no normal download control. This is deterrence, not unbreakable DRM.

Parent course checkout no longer uses prompt dialogs: the family can select an access plan and one or more children, while a one-child family is selected automatically. A purchased family license exposes a separate access-management sheet, so another child can be added later for free while preserving the original shared expiry date. Parent API scope was hardened so another family's license cannot be modified, and parent actors cannot lower the server-side plan price.

The Admin builder also exposes active license/student counts and recent learner progress for the course.

Runtime note: local/production workers need `pdftoppm` (Poppler) for PDF page processing, and API/worker processes must share the configured `STORAGE_DIR` until the object-storage adapter is enabled.

Architecture note:

- `docs/architecture/0022-course-builder-content.md`

## Next slice

The next larger package should finish the learner-side course loop: a dedicated `Мої помилки` practice flow that generates analogous problems, course-sourced tutoring leads from low test results, course progress visibility for parents/Admin, and course-access renewal/upgrade behavior. After that, the project should enter an integration-hardening pass with a real dependency install, database migration run, build/typecheck/tests and end-to-end smoke scenarios.

## Course learner progress (v23)

Learner-side courses now include an end-to-end progress loop:

```text
Test attempt
  → immutable result history
  → wrong templates enter "Мої помилки"
  → analogous practice task
  → correct practice marks the mistake corrected
```

Course progress summary:

```text
GET /api/course-enrollments/:id/progress-summary
GET /api/course-enrollments/:id/test-history
GET /api/test-attempts/:attemptId/result
```

Mistake practice:

```text
GET   /api/mistakes?courseEnrollmentId=:id
POST  /api/mistakes/:mistakeId/practice/start
PATCH /api/mistake-practice/:attemptId
```

A low test result does not lock later lessons. The learner can repeat the material, practice mistakes, or ask for tutoring. Tutor escalation creates a normal CRM lead sourced from the course:

```text
POST /api/course-enrollments/:id/tutor-request
```

The CRM lead preserves the source course/test/topic and is deduplicated while an open request for the same course/topic already exists.


## M1.18 Admin dashboard + settings + analytics (v24)

The Admin home is now a school-control surface rather than only a handful of counters. It separates school-size metrics, operational attention, current-month learning activity, current-month financial control and the active payroll payout window. `CHARGED_NO_SHOW` remains explicitly excluded from the conducted-lesson count.

Period analytics are available from:

```text
GET /api/ops/analytics?from=2026-09-01&to=2026-09-30&bucket=day
```

The response includes customer revenue, teacher accruals, the operational difference before other school costs, paid-order count, conducted/first/30-minute/no-show activity, revenue by tutoring subject/first lessons/courses, teacher accruals by subject and a day/month trend. The Admin finance UI now exposes date presets and custom date ranges.

`school_settings` now contains presentation/validation metadata. The settings page no longer edits raw JSON with browser prompts: numeric ranges, dates, month-day values and IANA time zones are validated by the API, critical rules are marked visually, and each setting has a dedicated audit-history view.

The runtime now reads configurable values for the regular reservation tail, parent reschedule cutoff, teacher marking deadline, student no-show wait, clean-streak reset, School Year/Summer boundaries and fixed first-lesson teacher pay. Worker notification and payroll settings continue to use the same settings table.

Architecture note:

- `docs/architecture/0024-admin-dashboard-settings-analytics.md`

## Next slice

The next larger package should be an integration-hardening pass plus the remaining commercial/admin gaps: subject-price and promotion UI, parent regular-lesson checkout contract (still provider-agnostic), public-site/lead smoke paths, then a real dependency install + migration run + build/typecheck/tests and end-to-end beta scenarios.

## M1.19 Subject pricing + promotions + parent checkout (v25)

Subject commerce is now explicit end-to-end. Admin has a dedicated `Предмети й тарифи` workspace with current/next subject prices, derived 30-minute pricing, first-lesson price, immutable price history and scheduled future tariffs. Only future tariff versions can be cancelled; already effective prices remain historical evidence and old lesson credits are never repriced.

Promotions now support automatic or promo-code campaigns across regular lessons, first lessons and courses. They may target one product or all products of that type. Percentage, fixed-amount and special-price campaigns are supported, promo codes are case-insensitive unique, and the pricing engine chooses the strongest eligible discount. Applied promotions are snapshotted on orders so disabling a campaign later cannot rewrite historical billing.

The parent `Оплати` screen now includes a provider-agnostic regular-lesson checkout flow. The configured minimum online quantity is enforced server-side; parents may choose any integer quantity at or above it, preview current pricing/discounts, and create a `PENDING_PAYMENT` order with an immutable tariff/promotion snapshot. No credits are granted until a future payment provider confirms the order, while manager-entered payments remain fully operational.

A free/discounted first-lesson campaign can also be recognized when the manager records the matching amount; teacher first-lesson pay remains completely independent of the customer promotion.

Architecture note:

- `docs/architecture/0025-subject-pricing-promotions-checkout.md`

## Next slice

The next package should move into integration hardening rather than adding more domain breadth: install dependencies, run every migration against a fresh PostgreSQL database, perform full TypeScript builds/typechecks/tests, seed realistic roles/data, and exercise the primary Admin → Manager → Teacher → Parent → Student vertical scenarios. Any schema/API drift found there should be fixed before adding the final real payment-provider adapter.


## M1.20 Integration hardening (v26)

This pass focuses on running the existing platform as one coherent system rather than adding another major product domain. Startup configuration is now validated, production encryption/MFA secrets cannot silently fall back to development defaults, root `.env` loading works consistently from pnpm/turbo package working directories, and both API and worker close PostgreSQL connections cleanly on shutdown.

The worker payroll materializer now reads the same configurable `payroll_anchor_date`, `payroll_period_days` and `payroll_payout_window_days` values as the API. This fixes a real cross-process drift where changing payroll settings in Admin could previously leave worker-created periods on the original hard-coded 14-day / 3-day rhythm.

The API exposes `/api/health/ready`, which performs a database query, and Turbo now builds workspace dependencies before `dev`, `typecheck` and `test`. API tests were moved from an unconfigured Jest+TypeScript path to `tsx --test` / Node test, matching the worker. Additional tests cover production env safety and configurable worker payroll settings.

A new dependency-free `scripts/check-integration.mjs` verifies migration sequencing/dependencies, relative imports, permission/settings/notification registries, duplicate API routes and env documentation. `pnpm verify:static` runs it together with the existing foundation check; `pnpm verify` adds full typecheck/tests/build once dependencies are installed.

A GitHub Actions workflow now provisions fresh PostgreSQL 17, applies all migrations, seeds baseline users, runs checks/typecheck/tests/build and starts the built API for a readiness smoke test.

Authoring-environment limitation: npm registry access and local PostgreSQL/Docker were unavailable during this pass, so the full dependency-aware build and fresh-PostgreSQL migration execution are represented in CI but are not claimed as executed here. Pure TypeScript business tests and repository-wide static checks were executed successfully.

Architecture note:

- `docs/architecture/0026-integration-hardening.md`

## Next slice

Run the repository in a normal development machine/CI with dependency and PostgreSQL access, commit the generated `pnpm-lock.yaml`, fix any dependency-level type/build errors that appear, then exercise the primary Admin → Manager → Teacher → Parent → Student E2E scenarios before adding the real payment-provider adapter.

## M1.21 E2E beta hardening (v27)

The primary `Admin → Manager → Teacher → Parent → Student` journey is now an executable beta gate rather than a manual checklist. A dedicated `pnpm db:seed:e2e` fixture creates isolated role identities plus a minimum linked school graph: manager/teacher profiles, one family, a parent, a student, an active mathematics enrollment, primary teacher and primary manager assignments.

The E2E seed is intentionally deterministic for disposable test databases. It clears sessions for its E2E identities and resets the E2E Admin MFA state so every clean acceptance run exercises the actual first-time TOTP setup path instead of introducing an authentication bypass. The command requires `E2E_ALLOW_SEED=true`. In v32, production-mode staging/RC may additionally opt in with `E2E_ALLOW_STAGING_SEED=true`; `APP_ENV=production` remains unconditionally blocked.

API acceptance is available through:

```bash
pnpm e2e:api
```

It verifies readiness, invalid/anonymous authentication, session cookies, Admin MFA enforcement/setup, representative positive role access, negative RBAC/portal isolation and logout revocation.

Browser acceptance uses Playwright:

```bash
pnpm db:seed:e2e
pnpm e2e:web
```

The UI suite signs in as every primary role, completes Admin MFA in the real UI, verifies the role landing shell and representative role navigation, and asserts the seeded Parent/Student relationship is visible. `pnpm e2e` seeds deterministic state before the API flow, reseeds it again before the browser flow, then runs both acceptance suites; API and web must already be running for local use.

CI now installs Chromium, seeds the E2E role graph, starts the production API/web builds and executes both API and browser acceptance. On a browser failure it retains Playwright traces/screenshots/video together with API/web runtime logs as CI artifacts.

Authoring-environment limitation: this archive could not perform `pnpm install` because DNS access to `registry.npmjs.org` returned `EAI_AGAIN`, so dependency-aware TypeScript/build/PostgreSQL/Playwright execution is not claimed locally. The dependency-free foundation/integration checks and repository-wide TS/TSX syntax parse do run in this environment; the full acceptance path is wired into CI.

Architecture note:

- `docs/architecture/0027-e2e-beta-hardening.md`

## Next slice

After the first green dependency-aware CI run, fix any package/type/runtime drift it exposes and then add the real payment-provider adapter behind the provider-agnostic checkout contract. Keep the v27 role E2E suite as the regression gate while payment callbacks, idempotency and credit granting are added.

## Multi-provider online payments (v29)

Online payments remain disabled by default. v29 keeps the v28 LiqPay adapter and adds Monobank acquiring behind one provider contract. A checkout order records its selected provider, so an idempotent checkout cannot accidentally be paid through two gateways.

Example dual-provider configuration with Monobank as the parent-facing default:

```text
PAYMENT_PROVIDER=NONE
PAYMENT_DEFAULT_PROVIDER=MONO

MONO_ENABLED=true
MONO_TOKEN=<merchant acquiring token>
MONO_WEBHOOK_URL=https://api.example.com/api/integrations/payments/mono/webhook
MONO_RESULT_URL=https://school.example.com/parent/payments
MONO_API_URL=https://api.monobank.ua
# Optional: otherwise the API obtains /api/merchant/pubkey and caches it.
MONO_WEBHOOK_PUBLIC_KEY_BASE64=

LIQPAY_ENABLED=true
LIQPAY_PUBLIC_KEY=<merchant public key>
LIQPAY_PRIVATE_KEY=<merchant private key>
LIQPAY_CALLBACK_URL=https://api.example.com/api/integrations/payments/liqpay/callback
LIQPAY_RESULT_URL=https://school.example.com/parent/payments
```

Monobank checkout creates an invoice through `/api/merchant/invoice/create` and redirects the parent to its returned `pageUrl`. Server callbacks are verified against the exact raw HTTP body using the `x-sign` ECDSA/SHA-256 signature and the merchant public key. `modifiedDate` is persisted so an older webhook delivered later cannot regress a newer payment state. LiqPay continues to use its API v7 SHA3-256 `data`/`signature` callback verification. Browser result-page redirects are never proof of payment for either provider.

Staff with `billing.refund` can issue full or partial refunds of unused purchased lesson units through the provider that captured the payment. Confirmed refunds revoke the corresponding purchase credits. A network timeout while sending a refund stays `PENDING` with `transport_unknown` instead of being treated as a definite failure, preventing an unsafe retry after an unknown provider outcome.

The v29 API E2E flow covers both gateways: LiqPay success/refund regression plus Monobank invoice creation, invoice reuse, invalid signature rejection, signed success webhook, duplicate-event idempotency, stale/out-of-order event rejection and callback-confirmed partial refund. CI starts local HTTP mocks for both providers.

See `docs/architecture/0029-multi-provider-mono-payments.md` for the provider contract, webhook state rules, refund semantics and source links.


## Production readiness / security / observability (v30)

v30 hardens the v29 product for controlled production rollout instead of adding another business module. Sensitive public endpoints now use PostgreSQL-backed distributed rate limiting, request origins are checked on mutating browser requests, API/web security headers are emitted, production/payment callback URLs are required to use HTTPS, and proxy trust is explicit rather than inferred.

API logs are structured JSON with request ids and defensive redaction. Metrics are available in Prometheus text format behind an optional bearer token, with separate liveness/readiness endpoints. Unhandled 5xx events can be forwarded to a vendor-neutral redacted error-reporting webhook without sending request bodies.

PostgreSQL backup/verify/restore scripts and deployment/recovery runbooks are included. `pnpm smoke:production` validates health, database readiness, web/API security headers and can exercise origin rejection, distributed login limiting and the protected metrics endpoint.

See:

- `docs/architecture/0030-production-security-observability.md`
- `docs/runbooks/deployment.md`
- `docs/runbooks/backup-restore.md`

## Release candidate / staging

v31 adds a frozen-dependency staging gate, immutable Docker build definitions, worker heartbeat/release identity, and a staging runbook. A real reviewed `pnpm-lock.yaml` is required before release images or release CI can pass. See `docs/runbooks/staging-release-candidate.md`.


## Final beta acceptance / payment reconciliation (v32)

v32 turns the release-candidate checks into one evidence-producing go/no-go gate. `pnpm acceptance:beta` requires a reviewed lockfile, immutable `RELEASE_SHA`, a verified backup artifact and explicit staging/RC E2E acknowledgement; it then runs staging smoke, the full API payment/RBAC flow, browser role flow and a final release-parity/reconciliation check. Evidence is written under `artifacts/`.

Payment-provider callbacks that cannot be safely finalized now enter an explicit reconciliation queue. Staff with `billing.reconcile` can review and resolve an event with an operator note; the provider payload/error remains retained and the resolution is audit logged. The E2E suite verifies that a late success for a cancelled checkout creates reconciliation without granting credits, then explicitly resolves it before final acceptance.

The staging compose topology now includes Caddy as the public TLS terminator for separate web/API hostnames. Automatic HTTPS is the reference staging topology; application ports remain loopback-only for diagnostics.

See:

- `docs/architecture/0032-final-beta-acceptance.md`
- `docs/runbooks/final-beta-acceptance.md`
