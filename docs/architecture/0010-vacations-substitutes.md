# 0010 — Vacation operations and substitute teachers

This slice closes the operational gap between an approved teacher vacation and the live lesson calendar.

## Vacation workflow

1. Teacher creates a vacation request.
2. Until approval, availability and existing lessons are unchanged.
3. Manager/Admin approves or rejects the request.
4. An approved vacation immediately blocks the teacher's availability for the date range.
5. Existing scheduled lessons are not silently deleted. They appear in the vacation operations queue as unresolved lessons.
6. Staff resolves each lesson by either assigning an available substitute or moving a regular lesson to the end of the paid/planned sequence.

The impacted list is dynamic: a lesson disappears once its `actual_teacher_id` changes to a substitute or its start date moves outside the vacation interval.

## Substitute eligibility

A substitute candidate must:

- be an active, non-archived teacher;
- actively teach the lesson subject;
- be available for the whole lesson interval according to seasonal templates, one-off exceptions and approved vacations;
- have no overlapping live session at that time.

The database exclusion constraint remains the final concurrency guard when the substitute is assigned.

## Notifications

`SUBSTITUTE_ASSIGNED` is a first-class notification event. The substitute teacher and family can receive the change through enabled channels. The lesson continues to keep the original `primary_teacher_id`, while `actual_teacher_id` points to the substitute, so journal continuity and Zoom routing remain correct.
