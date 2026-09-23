# 0013 — Teacher students, shared journal and report actions

This slice replaces the generic operational student table in the teacher cabinet with a teacher-scoped workflow.

## Teacher student list

`GET /api/teachers/me/students` returns only students for whom the authenticated teacher has a regular primary-teacher assignment. The endpoint supports `ACTIVE`, `ARCHIVED` and search scopes. Each student is grouped with the teacher's subject enrollments and includes:

- grade;
- subject and enrollment state;
- current regular schedule when the relationship is active;
- current lesson-unit balance;
- last conducted/charged lesson timestamp.

Substitute-only students are intentionally not added to the regular `My students` list.

## Teacher student detail

`GET /api/teachers/me/students/:studentId` is also available when the teacher only conducted a substitute lesson for the student. This keeps the calendar → journal flow valid for substitutes without turning that student into a regular teacher assignment.

The response exposes only enrollments related to that teacher, parent contact information, current balance/schedule where applicable, the next session, and pending progress-report requests the teacher is allowed to complete.

## Journal visibility

The journal remains student+subject shared learning history:

- the current primary teacher sees all completed sessions, including substitute sessions;
- a substitute or former teacher who is not the current primary teacher sees only sessions they actually conducted;
- entries show `Провів: ...` only when the actual teacher differs from the session's primary teacher;
- a charged no-show is not represented as a normally completed journal lesson.

Teacher access to `/students/:id/enrollments` and `/enrollments/:id` is now enrollment-scoped so a teacher related to one subject cannot read unrelated subjects of the same student.

## Report completion

Pending parent-requested progress reports are surfaced directly on the teacher student page. The teacher fills strengths, gaps and the next-learning plan and completes the existing report request through the established report service. Existing visibility rules and parent/student notifications remain unchanged.
