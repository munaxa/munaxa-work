import type { UnitOfWork } from '@work/kernel';

import type { CountryRulePort } from '../domain/country-rule.js';
import type { PayrollStores } from './payroll-ports.js';
import type {
  AttendanceSourcePort,
  Clock,
  CompensationSourcePort,
  EmploymentSourcePort,
  LeaveSourcePort,
  OrganizationSourcePort,
} from './cross-module-ports.js';

/**
 * Everything this module's use cases need, injected once.
 *
 * Handlers are built by factory functions taking this, rather than resolving from a container
 * inside the handler. It costs a line of wiring and buys handlers testable against fakes with no
 * framework present.
 *
 * The five source ports are **ports, not imports of those modules**. Each runs through the owning
 * module's published application service under a bounded service grant (ADR-0043), so running a
 * payroll does not make somebody a reader of the employment register, the attendance log, the leave
 * ledger or the compensation record.
 *
 * `countryRules` is the extension point for statutory calculation and **nothing implements it**.
 * The only adapter that ships is `noCountryRules`, which returns nothing for every country, and
 * that is the correct behaviour for a product with no country pack — a payroll with no statutory
 * lines rather than one calculated from a guess at somebody's tax law (ADR-0067).
 *
 * Deliberately absent:
 *
 * **No `ApprovalPort`.** The only adapter is `AutoApprovingPort`, which approves as
 * `system:auto-approval`. An approval is the moment somebody accepts responsibility for what a
 * workforce is about to be paid; recording an adapter as that person would be a false statement in
 * an audit trail (ADR-0045, ADR-0060, D-12).
 *
 * **No `NotificationPort`.** `RecordingNotificationPort` records; it does not deliver. Claiming to
 * notify an approver through an adapter that writes to an array would claim a workflow exists.
 *
 * **No `DocumentPort`, no exchange-rate port, no Finance port, no bank port.** None exists in this
 * repository, and none is invented. Payslip rendering, currency conversion, accounting posting and
 * payment execution are each `NOT VERIFIED`.
 */
export interface PayrollDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly stores: PayrollStores;
  readonly employment: EmploymentSourcePort;
  readonly compensation: CompensationSourcePort;
  readonly attendance: AttendanceSourcePort;
  readonly leave: LeaveSourcePort;
  readonly organization: OrganizationSourcePort;
  /** Inert in Phase 11. `noCountryRules` is the only implementation that ships. */
  readonly countryRules: CountryRulePort;
  readonly clock: Clock;
}
