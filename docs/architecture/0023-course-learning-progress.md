# 0023 — Course learning progress, mistake practice and tutor escalation

## Scope

This slice completes the learner-side course loop without blocking course progression after a weak test result.

- every completed test attempt remains immutable history;
- incorrect question templates are aggregated in `student_mistakes`;
- `mistake_practice_attempts` stores each remediation task as the exact prompt/answer snapshot shown to the learner;
- generated question templates produce an analogous task with new values;
- static templates fall back to the original prompt until a generator is configured;
- a correct remediation answer marks the aggregated mistake as `CORRECTED`, while historical wrong attempts remain available;
- parents/students can inspect test history and a progress summary;
- admins can inspect the same progress from the course builder;
- weak results can create a CRM lead with `source=COURSE` instead of blocking the course.

## Course-sourced tutor lead

The lead stores the source course, course enrollment, optional weak test attempt and optional topic. An open lead is deduplicated by course enrollment + topic so repeated CTA presses do not create CRM spam.

The lead uses the family's existing parent contact and the student's existing primary manager where available. The CTA never changes course progress or tutoring enrollment automatically; a manager follows up and handles conversion through the normal CRM flow.

## Explanation entitlement

Practice/test result endpoints continue to respect the course license's `explanations_enabled` snapshot. Base access returns correct/incorrect only; premium access may return stored explanation content.
