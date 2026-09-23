# 0003 — Teacher, Subject and Enrollment slice

## Purpose

This slice connects students to academic subjects and one primary teacher. It introduces the first subject-agnostic academic model without adding schedule occurrences yet.

The central invariant is:

```text
one student + one subject = one StudentSubjectEnrollment
one active primary teacher per enrollment
```

An enrollment is reused when a student pauses and later returns to the same subject, preserving journal, balance and assignment history in one place.

## Tables

- `subjects`
- `teacher_profiles`
- `teacher_subjects`
- `teacher_rate_versions`
- `student_subject_enrollments`
- `teacher_assignments`

## Teacher rates

Teacher pay is subject-specific and versioned by effective date. Rates are stored in currency minor units (`20000` = `200.00 UAH`). The database uses an exclusion constraint to reject overlapping effective periods for the same teacher/subject relation.

Only users with `teacher.rate.manage` may create rate versions. The default role seed grants that permission only to `ADMIN`.

## Primary teacher history

Changing the primary teacher never overwrites the old teacher assignment. The active assignment is closed with `ended_at`, then a new assignment is inserted. A partial unique index guarantees that an enrollment cannot have two active primary teachers at once.

A temporary substitute will later live on a concrete `LiveSession.actual_teacher_id`; it will not replace the primary `TeacherAssignment`.

## API

- `POST /api/subjects`
- `GET /api/subjects`
- `GET /api/subjects/:subjectId`
- `POST /api/teachers`
- `GET /api/teachers`
- `GET /api/teachers/:teacherId`
- `POST /api/teachers/:teacherId/subjects`
- `POST /api/teachers/:teacherId/subjects/:subjectId/rates`
- `GET /api/teachers/:teacherId/rates`
- `POST /api/students/:studentId/enrollments`
- `GET /api/students/:studentId/enrollments`
- `GET /api/enrollments/:enrollmentId`
- `POST /api/enrollments/:enrollmentId/assign-teacher`

## Account lifecycle

Operational teacher creation creates a `PENDING` user and an `INVITED` teacher profile. The final email invitation/password setup flow remains a later slice. Optional development seed data creates an active teacher account so the scheduling/calendar slice can be exercised locally before invitation delivery exists.

## Next slice

Teacher availability, seasonal templates, regular schedule versions, concrete live sessions, conflict constraints and the first calendar query.
