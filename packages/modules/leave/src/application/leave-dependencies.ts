import type { UnitOfWork } from '@work/kernel';

import type { Clock, EmploymentDirectoryPort, LeaveStores, WorkingDayPort } from './leave-ports.js';

/**
 * Everything this module's use cases need, injected once.
 *
 * Handlers are built by factory functions taking this, rather than resolving from a container
 * inside the handler. It costs a line of wiring and buys handlers testable against fakes with no
 * framework present — the difference between a balance test that runs in milliseconds and one that
 * needs a database, a Nest module and three other domains to start.
 *
 * `employment` and `workingDays` are **ports, not imports of those modules**. Both run through the
 * owning module's published application service under a bounded service grant (ADR-0043), so an HR
 * administrator approving leave does not thereby become a reader of the employment register or of
 * somebody's attendance record.
 *
 * There is deliberately **no `ApprovalPort`**. The only adapter in this repository is
 * `AutoApprovingPort`, which approves everything immediately as `system:auto-approval`. Leave
 * approval authorizes paid absence; treating an automatic approval as a human decision would be
 * recording something that did not happen, which is the fake completeness this phase forbids
 * (ADR-0045, and decision D-3). Leave records its own decision, by a named human, and publishes the
 * chain in `ApprovalPort`'s shape so Phase 16 can change the *source* without changing the
 * contract.
 *
 * There is deliberately **no `NotificationPort`**. `RecordingNotificationPort` records; it does not
 * deliver. A leave module that claimed to notify an approver, through an adapter that writes to an
 * array, would be claiming a workflow exists. Leave raises domain events; Communications (Phase 17)
 * subscribes when it can address a recipient.
 *
 * There is deliberately **no `DocumentPort`**. No adapter implements it anywhere in this
 * repository, so an attachment is a *reference* Leave stores and never verifies. The completion
 * report says so rather than claiming document upload works.
 *
 * There is deliberately **no money, no rate and no payroll port**. What a leave day costs is
 * Payroll's, and Phase 9 publishes a contract for it to read rather than computing anything (§21).
 */
export interface LeaveDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly stores: LeaveStores;
  readonly employment: EmploymentDirectoryPort;
  /** Attendance's published working-day read. `known: false` is refused, never approximated. */
  readonly workingDays: WorkingDayPort;
  readonly clock: Clock;
}
