# Final QA and Design Checklist

Updated: 2026-09-28

This is the working checklist for final stabilization and the visual pass.
Do not repeat PASS/AUTO items unless later code changes touch them.

## 1. Functional QA

### Reschedule and attendance
- [x] PASS — Student advance reschedule: same session, FREE_SLOT, no new incident.
- [x] PASS — Student technical / force-majeure: same session, no incident, no charge.
- [x] PASS — Student no-show blocked until lesson start + 15 minutes.
- [x] PASS — Student second no-show: CHARGED_NO_SHOW, credit debit, teacher payroll accrual, strike reset.
- [x] PASS — Teacher advance reschedule: same session, no incident.
- [x] PASS — Teacher late cancellation second strike: compensation granted and strike reset.
- [x] PASS — Teacher technical / force-majeure: no incident and no compensation.
- [ ] SKIP FOR NOW — Undo teacher late cancellation after second strike.
- [ ] TODO MANUAL — Parent reschedule more than 2 hours before lesson.
- [ ] TODO MANUAL — Parent reschedule inside 2-hour cutoff must be blocked.
- [x] PASS — Admin historical/manual reschedule permission.
- [x] PASS — Manager without lesson.reschedule.past cannot use administrative reschedule.
- [x] PASS — Manager temporary grant enables administrative reschedule; revoke disables it.
- [ ] TODO MANUAL — Administrative reschedule rejects teacher overlap.
- [ ] TODO MANUAL — Administrative reschedule rejects student overlap.
- [ ] TODO MANUAL — Administrative reschedule rejects time outside teacher availability.
- [ ] TODO MANUAL — Administrative reschedule writes expected audit record.

### Lesson marking
- [ ] TODO MANUAL — Mark button visible before lesson start but disabled.
- [ ] TODO MANUAL — Mark becomes available exactly from lesson start.
- [ ] TODO MANUAL — Teacher mark window expires after configured deadline.
- [x] AUTO — First lesson can be completed after start with required INITIAL report.
- [x] AUTO — First lesson completion creates FIRST_LESSON payroll accrual.
- [x] AUTO — First lesson outcome undo restores SCHEDULED state.

### First lesson scheduling
- [x] AUTO — Manager can create FIRST lesson.
- [x] AUTO — FIRST lesson teacher conflict returns controlled 409.
- [x] AUTO — FIRST lesson payment flow.
- [x] AUTO — FIRST lesson complete + undo lifecycle.
- [ ] TODO MANUAL — Recheck local manager FIRST lesson creation after pulling latest branch.

### Progress reports and calendar
- [x] PASS — Requested progress report flow.
- [x] PASS — Parent/student report visibility toggle.
- [x] PASS — Report threshold restored to 5 lessons.
- [x] PASS — Calendar visual regression.
- [x] PASS — Non-bookable free gaps under 30 minutes hidden.
- [x] PASS — Lesson sheet locks background page scroll.

### Final finance/data smoke
- [ ] TODO MANUAL — Student balance after final QA scenarios.
- [ ] TODO MANUAL — Payroll accruals after final QA scenarios.
- [ ] TODO MANUAL — Journal state after final QA scenarios.
- [ ] TODO MANUAL — Calendar state after final QA scenarios.
- [ ] TODO MANUAL — Reports state after final QA scenarios.

## 2. UI system pass

Already implemented:
- [x] Shared glass interaction polish.
- [x] Administrative reschedule visual panel.
- [x] Shared 24-hour date/time controls.
- [x] Password visibility control.
- [x] Lesson action sheet polish.

Remaining:
- [ ] Audit base radius/border/shadow/blur/spacing tokens.
- [ ] Audit primary/secondary/danger button hierarchy.
- [ ] Audit hover/pressed/disabled/loading/focus-visible states.
- [ ] Audit cards/notices/badges/sheets/modals for consistency.
- [ ] Audit destructive/correction actions so they do not compete with primary actions.

## 3. Date/time and forms
- [x] Shared formatters use Europe/Kyiv and 24-hour hour cycle.
- [x] FIRST lesson uses explicit Kyiv wall-time conversion.
- [x] FIRST lesson uses 24-hour TimeSelect24.
- [x] Administrative reschedule uses custom DateTimeFields24.
- [ ] Audit remaining date/time controls route-by-route.
- [ ] Verify 00:00, 09:05, 15:30, 23:59 rendering.
- [ ] Verify date/time behavior around Europe/Kyiv DST boundaries.

## 4. Route-by-route visual QA

Order:
1. Login / MFA / recovery.
2. Sidebar / topbar / mobile navigation.
3. Dashboards.
4. Calendar and lesson sheets.
5. Students / families.
6. Teachers.
7. First lessons.
8. Payments / finance.
9. Reports / journal.
10. Settings / team / audit.
11. Parent portal.
12. Student portal.
13. Teacher portal.

For each route check:
- long names and long text;
- empty states;
- errors;
- loading;
- disabled controls;
- narrow viewport/table overflow;
- scroll behavior;
- sticky elements;
- text wrapping;
- badges/status colors;
- phone formatting;
- large monetary values;
- keyboard navigation and focus-visible.

## 5. Brand layer — after functional + visual stabilization
- restrained modern operational UI as the base;
- glass used as an accent rather than everywhere;
- friendly frog mascot/illustrations mainly in login, dashboards, empty states, achievements and student-facing surfaces;
- admin/finance/audit surfaces stay visually calmer;
- one consistent mascot system rather than unrelated illustrations.
