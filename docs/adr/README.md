# Architecture Decision Records

ADR-0001 to ADR-0020 are the founding decisions, recorded in
[`work prompts/26_ARCHITECTURE_DECISION_RECORDS.md`](../../work%20prompts/26_ARCHITECTURE_DECISION_RECORDS.md).
Every decision made from implementation onward is recorded here as its own file, numbered
from ADR-0021.

An ADR is never modified silently. A superseded ADR keeps its file and gains a `Superseded by`
line; the decision that replaced it is a new record.

| ADR                                              | Title                             | Status   |
| ------------------------------------------------ | --------------------------------- | -------- |
| [0021](0021-engineering-standards-enforcement.md) | Engineering standards enforcement | Accepted |
| [0022](0022-master-instructions-enforcement.md)   | Master instructions enforcement   | Accepted |
| [0029](0029-ecosystem-file-naming.md)             | File naming follows the ecosystem | Accepted |
| [0030](0030-tenant-isolation.md)                  | Tenant isolation                  | Accepted |
| [0031](0031-android-host-project.md)              | The Android host project          | Accepted |
| [0032](0032-tenant-resolution-from-membership.md) | Tenant resolution from membership | Accepted |
| [0033](0033-tenant-less-workforce-user.md)        | The tenant-less workforce user    | Accepted |
| [0034](0034-hierarchy-as-typed-nodes.md)          | The hierarchy is one node table, not nine | Accepted |
| [0035](0035-country-from-legal-entity.md)         | A country belongs to a legal entity, never a tenant | Accepted |
| [0036](0036-tenant-settings-owned-by-organization.md) | Tenant settings owned by Organization | Accepted |
| [0037](0037-legal-name-is-effective-dated.md)    | A person's legal name is effective-dated; every other attribute is not | Accepted |
| [0038](0038-personal-data-protection.md)         | How personal data is protected in People | Accepted |
| [0039](0039-employment-number.md)                | The employment number is generated, tenant-scoped, immutable and never reused | Accepted |
| [0040](0040-employment-lifecycle.md)             | The employment lifecycle, and why "on leave" belongs to Leave | Accepted |
| [0041](0041-work-location-is-not-modelled.md)    | Work location is not modelled, and no false relationship stands in for it | Accepted |
| [0042](0042-how-employment-references-another-module.md) | How Employment references another module: one foreign key, one published query, one gap | Accepted |
| [0043](0043-bounded-service-grant.md)            | The bounded service grant | Accepted |
| [0044](0044-a-candidate-is-not-a-person.md)      | A candidate is not a person | Accepted |
| [0045](0045-requisition-approval-is-real.md)     | A requisition approval is made by a named human, not by an adapter | Accepted |
| [0046](0046-the-hire-is-a-saga.md)               | The hire is a saga with a recoverable state, not a distributed transaction | Accepted |
| [0047](0047-onboarding-owns-no-employment-fact.md) | Onboarding owns no employment fact, and creates neither a Person nor an Employment | Accepted |
| [0048](0048-plan-versions-are-immutable.md)      | A plan version is immutable once published, and an instance copies its tasks at creation | Accepted |
| [0049](0049-onboarding-is-not-a-workflow-engine.md) | Onboarding is a checklist with one predecessor per task, not a workflow engine | Accepted |
| [0050](0050-onboarding-starts-by-command-not-by-event.md) | An onboarding is started by an idempotent command and guaranteed by reconciliation, never by an event | Accepted |
| [0051](0051-attendance-owns-no-employment-fact.md) | Attendance owns no employment fact, and attaches to an employment rather than to a person | Accepted |
| [0052](0052-a-raw-time-event-is-immutable.md)    | A raw time event is immutable, and a correction inserts rather than edits | Accepted |
| [0053](0053-recalculation-is-found-by-asking.md) | Recalculation is found by asking, not by being told | Accepted |
| [0054](0054-attendance-produces-candidate-minutes.md) | Attendance produces candidate minutes, never money, and freezes them in sequence | Accepted |
| [0055](0055-the-schedule-owns-the-time-zone.md)  | The schedule owns the time zone, and a punch coordinate is evidence rather than a work location | Accepted |
| [0056](0056-leave-unknown-is-not-leave-none.md)  | "Leave unknown" is not "no leave", and Attendance refuses to collapse them | Accepted |
| [0057](0057-a-vendor-is-not-a-source.md)         | A vendor is not a source: devices reach Attendance through a normalized contract | Accepted |
| [0058](0058-attendance-pulls-leave-changes.md)   | Attendance pulls leave changes; Leave never writes to Attendance | Accepted |
| [0059](0059-the-leave-ledger-is-authoritative.md) | The leave ledger is authoritative; the balance is a projection | Accepted |
| [0060](0060-leave-ships-no-statutory-content.md) | Leave ships no statutory content, and approval is recorded rather than delegated | Accepted |
| [0061](0061-money-carries-its-currency-exponent.md) | Money is integer minor units carrying its own currency exponent | Accepted |
| [0062](0062-compensation-states-entitlement.md)  | Compensation states entitlement; Payroll determines payment | Accepted |
| [0063](0063-a-compensation-change-supersedes.md) | A compensation change supersedes; a pay grade is not a job grade | Accepted |
| [0064](0064-payroll-calculates-from-a-snapshot.md) | Payroll calculates from an immutable snapshot, never from a live source | Accepted |
| [0065](0065-a-candidate-is-not-an-approved-fact.md) | A candidate is not an approved fact, and configuration cannot promote one | Accepted |
| [0066](0066-finalized-payroll-is-immutable-at-the-table.md) | Finalized payroll is immutable at the table, not only in the code | Accepted |
| [0067](0067-payroll-publishes-outputs-and-posts-nothing.md) | Payroll publishes outputs and posts nothing, and an absent capability is named | Accepted |

Every ADR states: decision, reason, consequences, alternatives considered, date, author and
approval status.
