import type { UnitOfWork } from '@work/kernel';

import type { CompensationStores } from './compensation-ports.js';
import type {
  Clock,
  EmploymentDirectoryPort,
  OrganizationDirectoryPort,
} from './cross-module-ports.js';

/**
 * Everything this module's use cases need, injected once.
 *
 * Handlers are built by factory functions taking this, rather than resolving from a container
 * inside the handler. It costs a line of wiring and buys handlers testable against fakes with no
 * framework present.
 *
 * `employment` and `organization` are **ports, not imports of those modules**. Both run through the
 * owning module's published application service under a bounded service grant (ADR-0043), so an HR
 * administrator managing compensation does not thereby become a reader of the employment register
 * or of the organizational structure.
 *
 * There is deliberately **no `ApprovalPort`**. The only adapter in this repository is
 * `AutoApprovingPort`, which approves everything immediately as `system:auto-approval`. A salary
 * change is a control over money; treating an automatic approval as a human decision would be
 * recording something that did not happen (ADR-0045, ADR-0060, D-9). Compensation records its own
 * decision, by a named human, and publishes the chain in `ApprovalPort`'s shape so Phase 16 can
 * change the *source* without changing the contract.
 *
 * There is deliberately **no `NotificationPort`**. `RecordingNotificationPort` records; it does not
 * deliver. A module that claimed to notify an approver, through an adapter that writes to an array,
 * would be claiming a workflow exists.
 *
 * There is deliberately **no payroll port, no tax port, no currency-conversion port and no
 * benefits port.** What is actually paid for a period is Payroll's; Compensation publishes a
 * contract for it to read and computes nothing. No rate table exists anywhere in this module.
 */
export interface CompensationDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly stores: CompensationStores;
  readonly employment: EmploymentDirectoryPort;
  /** Organization's published legal-entity read. `known: false` is honest, never approximated. */
  readonly organization: OrganizationDirectoryPort;
  readonly clock: Clock;
}
