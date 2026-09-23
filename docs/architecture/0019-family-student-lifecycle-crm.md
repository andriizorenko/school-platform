# ADR 0019 — Family/student lifecycle and CRM surface

## Context

Operational history existed by v18, but managers still lacked a first-class family index, safe profile editing, explicit archive/reactivate rules and visible account-invitation state. Those gaps encouraged direct database fixes and made it too easy to confuse “inactive learning” with “archived person/family”.

## Decision

### Family and student lifecycle

`archived_at` remains the lifecycle switch; v19 adds `archived_by` and `archive_reason` for operational traceability.

Archiving a student is intentionally conservative. It is blocked while the student has an `ACTIVE` tutoring enrollment or any future `SCHEDULED` live session. Managers must first resolve learning through the existing pause/finish/reschedule flows. Archiving never destroys lesson-credit history or balance.

Archiving a family is blocked until all children are archived and no active, non-expired course license remains. This avoids silently cutting off an active child or course user.

Associated parent/student login accounts move to `ARCHIVED` and all sessions are revoked. A previously suspended user remains suspended. Reactivation restores an archived login to `ACTIVE` when a password exists or `PENDING` when the account still needs invitation activation; explicit suspension is not bypassed.

### Profile editing

Operational roles can update parent contact/name/email fields and student name/date-of-birth/grade fields. Every change is written to the audit log with before/after snapshots.

Changing the login email remains an audited administrative correction. A dedicated self-service email re-verification flow can be added later without changing the family/student model.

### Account invitations

Invitation state is surfaced directly in family and student cards. Pending parent/student accounts can be invited or re-invited from the operational UI. Invitations are rejected for archived/suspended accounts and for already activated accounts.

Email outbox payloads use one canonical shape:

```text
{ email, token }
```

which matches the worker email-delivery contract and the `/accept-invite` web route.

### Family CRM index

Admin/Manager/Support receive a dedicated family list with:

- parent/child/name/phone/email search;
- active/archive/all lifecycle filtering;
- “my families” manager scope;
- child counts, active tutoring count, managers and parent account status;
- direct navigation into the consolidated family card.

The student list receives the same active/archive/all lifecycle filter.

## Consequences

“Inactive tutoring” and “archived identity” are now separate concepts. Historical evidence remains intact, while operational lists can stay clean. Family/account onboarding is visible and actionable without exposing token values or authentication secrets.
