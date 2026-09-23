# 0008 — Calendar action UI

This incremental frontend slice replaces browser `prompt()` / `confirm()` interactions in the lesson calendar with structured in-product forms inside the existing desktop side sheet / mobile bottom sheet.

Implemented:

- regular lesson marking form: topic + homework assigned yes/no;
- first-lesson completion form: strengths + gaps + action plan;
- reschedule form with `datetime-local`, structured reason and optional comment;
- parent reschedule remains a one-off move and does not change the regular schedule;
- parent copy explicitly reflects the two-hour cutoff and same-teacher free-slot rule enforced by the API;
- student no-show and teacher late-cancellation incident confirmation forms;
- mobile calendar defaults to Day view; mobile Week remains the long Mon→Sun agenda with the compact weekday jump bar;
- desktop remains Week / Month only.

The API remains the source of truth for permissions, time cutoffs, teacher availability and incident policy outcomes.
