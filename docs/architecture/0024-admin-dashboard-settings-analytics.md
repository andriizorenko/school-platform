# 0024 — Admin dashboard, settings and school analytics

This slice turns the Admin area into a school-control surface instead of a collection of raw counters.

## Dashboard

The Admin dashboard now separates:

- school-size metrics;
- operational attention items;
- learning activity for the current month;
- current-month financial control;
- current payroll-window state.

`CHARGED_NO_SHOW` is intentionally not counted as a conducted lesson.

## Analytics

`GET /api/ops/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD&bucket=day|month`
returns a bounded school-wide period report with revenue, teacher accruals, operating difference, lesson activity, revenue breakdowns and a time-series.

The "operating difference" is explicitly not presented as net profit because taxes, advertising, management payroll, infrastructure and other school costs are outside the current accounting model.

## Settings

`school_settings` now carries presentation and validation metadata. Admin edits use typed fields instead of free-form JSON prompts. The API validates integer/number ranges, month-day/date formats and IANA time zones before persisting changes.

All setting updates remain transactional and audited. `GET /api/settings/:key/history` exposes the corresponding audit history to Admin.
