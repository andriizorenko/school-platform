# ADR 0022 — Course builder, private PDF pages and course access

## Status

Accepted for the first beta implementation.

## Scope

This slice turns the existing course data model into an operational Admin builder and hardens the learner access path.

### Admin authoring

Admin can now:

- edit course metadata and cover;
- create and reorder modules;
- create and reorder lessons;
- publish/unpublish individual lessons;
- compose lessons from `TEXT`, `PDF` and `TEST` blocks;
- reorder/delete lesson blocks;
- create MINI tests and timed KNOWLEDGE_CHECK tests;
- create static questions and basic generated arithmetic/linear-equation templates;
- associate questions with subject topics for the personal mistake bank;
- create duration-based or fixed-expiry access plans;
- enable/disable explanation access per plan;
- see active-license/student/progress summary before and after publication.

The ordering API receives the complete ordered id list for the parent scope. The backend first validates that every current item appears exactly once, shifts existing positions out of the unique-index range, and then writes the new positions.

## PDF security model

Original PDF files are private course assets. Uploading a PDF stores the original as `PROCESSING` and writes `FILE_PROCESS_PDF` to the transactional outbox.

The worker uses `pdftoppm` to create page PNGs. Each page becomes a `PDF_PAGE` asset linked through `pdf_processed_pages`. When processing succeeds the source asset changes to `READY`; failures keep an error message and are retried with backoff.

Learner/parent file access explicitly denies the original `PDF` asset. Lesson API responses expose only the processed page asset ids. The course viewer renders those images inside the lesson with a per-student visual watermark and no normal download control.

This reduces casual redistribution but is not DRM: screenshots or device-level copying cannot be completely prevented.

`pdftoppm` (Poppler) is therefore a runtime dependency of the worker. Local API and worker processes must share `STORAGE_DIR`; the example environment uses `../../storage` from the package working directories. Production object storage remains an adapter/deployment follow-up.

## Tests and generated questions

`QuestionTemplate` remains the stable skill/question definition. Every test attempt stores the concrete generated prompt and answer definition, so later generator changes cannot rewrite historical attempts.

The first generator implementation intentionally supports only a small declarative set:

- `ARITHMETIC`;
- `LINEAR_EQUATION`.

It is an extension point, not a generic code-evaluation engine.

Timed knowledge checks are enforced both in the UI and on the backend. Reattempts remain unlimited. Low scores never block course progression.

## Course access

A purchase creates one family `CourseLicense` with one shared expiry. One or more `CourseEnrollment` rows grant independent progress to children. A child added later receives the remaining license time, not a new full term.

Parent actors cannot override the access-plan price through the manual purchase endpoint. Operational staff may record a lower manual amount when school policy requires it. Old purchases retain price/access snapshots.

`explanations_enabled` remains snapshotted onto the license for the beta. This supports base/premium access plans without duplicating course content. A dedicated paid upgrade/add-on flow can later flip/add the entitlement without changing test content.

## Security notes

- Parent license detail/grant operations are scoped to the actor's family.
- Learners cannot fetch original PDFs.
- Tests must belong to the course license being used.
- Test answers cannot be changed after an attempt ends.
- Publication requires at least one module, one published lesson and one active access plan.
- Significant course/content/access changes are written to audit where applicable.
