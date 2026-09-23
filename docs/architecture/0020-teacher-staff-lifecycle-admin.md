# 0020 — Teacher and staff lifecycle / admin operations

This increment completes operational lifecycle management for teachers and internal staff without deleting historical school data.

## Teacher lifecycle

- Admin and Support Manager can edit operational teacher fields: name, phone, Zoom URL and start date.
- A teacher can edit their own name, phone and Zoom URL. They cannot edit their own pay rate, subjects, account role or start date.
- Teacher subjects can be activated/deactivated without deleting their historical relation.
- Archiving a teacher is blocked while they are the active primary teacher of any enrollment or still have future scheduled sessions. Those students/sessions must be reassigned first.
- Archiving sets both the teacher profile and user account to archived and revokes active login sessions. Reactivation restores the account to ACTIVE when a password exists, otherwise PENDING/INVITED.
- Account suspension remains a separate security action and is available only through the account suspension permission.

## Staff lifecycle

- Team management is Admin-only. Roles available in the Team screen are MANAGER, FINANCIER and SUPPORT_MANAGER.
- Admin can edit staff profile data, change one operational staff role, send/re-send invitations, suspend/restore the account, archive and reactivate it.
- A Manager cannot be archived while they are the active primary manager for students; students must be reassigned first.
- Historical manager assignments are retained.

## Payout details

- Teacher payout requisites are encrypted at rest by the Payroll service.
- Teacher, Admin and Financier may view/edit payout requisites according to `payroll.details.manage`.
- Other operational roles do not receive full banking details.
- Payout snapshots in already generated payouts remain immutable even if current requisites later change.

## Audit

Every profile update, role change, archive/reactivation, subject activation change and payout details update is written to the audit log. Passwords, MFA secrets and full banking details are never included in audit payloads.
