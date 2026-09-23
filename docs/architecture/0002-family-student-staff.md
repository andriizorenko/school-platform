# 0002 — Family, Student and Staff slice

## Purpose

This slice adds the first operational school data on top of the identity foundation.

The family model deliberately uses one parent account per family. A family can own multiple student profiles. A student profile always exists independently of a login account; `students.user_id` is nullable so a child account can be created later without moving learning data.

The primary manager is assigned per student, not per family. Assignment history is append-preserving: changing the primary manager closes the active row and creates a new one.

## Tables

- `families`
- `parent_profiles`
- `students`
- `staff_profiles`
- `student_manager_assignments`

## API

- `POST /api/families`
- `GET /api/families/:familyId`
- `POST /api/families/:familyId/students`
- `GET /api/students/:studentId`
- `POST /api/students/:studentId/primary-manager`
- `POST /api/staff`
- `GET /api/staff/managers`
- `GET /api/staff/:userId`

## Permission model

Business endpoints now use a global permission guard in addition to authentication. Controllers declare permissions using `@RequirePermissions(...)`; authorization is always enforced by the API, never only by the UI.

Important permissions introduced in this slice:

- `family.view`
- `family.manage`
- `student.view`
- `student.manage`
- `student.manager.assign`
- `staff.view`

## Audit

The following operations are audited transactionally with the business change:

- family creation
- student creation
- staff account creation
- primary-manager reassignment

The audit service can write through the current database transaction so a business mutation cannot commit without its audit event.

## Account lifecycle

Parent, student and staff users created by operational endpoints start as `PENDING`. Activation/invitation is intentionally deferred to the invitation slice. Development seeds may create active Admin and Manager users for local testing.
