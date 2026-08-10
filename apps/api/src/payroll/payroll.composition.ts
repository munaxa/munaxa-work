import { payrollModule, postgresPayrollStores, systemClock, noCountryRules } from '@work/payroll';
import {
  type Command,
  type Dispatcher,
  type HandlerFailure,
  type Query,
  type Result,
  type UnitOfWork,
  type WorkModule,
} from '@work/kernel';

import type { Asking } from './asking.js';
import { PayrollCompensationSource, PayrollEmploymentSource } from './payroll-sources.js';
import {
  PayrollAttendanceSource,
  PayrollLeaveSource,
  PayrollOrganizationSource,
} from './payroll-period-sources.js';

/**
 * Payroll's composition, and the five adapters that are the whole of its cross-module surface.
 *
 * Payroll reaches Employment, Compensation, Attendance, Leave and Organization through their
 * **published application services**, never their repositories. Each call runs inside a **bounded
 * service grant** (ADR-0043), for the reason every phase since Phase 6 has established: running a
 * payroll must not make somebody a reader of the employment register, the attendance log, the leave
 * ledger or the compensation record. The user is checked for the *payroll* operation; the module
 * holds the narrow cross-domain read.
 *
 * Each grant here:
 *
 * - is entered *inside* a handler the pipeline has already authorized;
 * - permits an **explicit list** of permissions — never a wildcard, never a prefix;
 * - **cannot nest**, so authority is not accumulated by composition;
 * - leaves the tenant, the actor and the correlation identifier untouched;
 * - is **observable**: every elevation is logged with the operation that caused it.
 *
 * **No adapter writes anything.** There is no `create` and no `update` on any of them, and no
 * method that could change a fact in another module. The dependency points one way and Payroll
 * pulls (ADR-0058, ADR-0064).
 *
 * Two absences are load-bearing. `organization.export-structure` is **never called** — the payroll
 * path uses the bounded legal-entity read and nothing else, because an unbounded structure export
 * on a per-run path is exactly the read D-17 forbids. And there is no attendance overtime call,
 * because no approved-overtime contract exists to call (ADR-0065).
 */

/**
 * A dispatcher handed over after it exists.
 *
 * Payroll's handlers do not send Payroll commands, so there is no cycle in the module itself — but
 * its five adapters need the dispatcher that is assembled *from* that list. It refuses rather than
 * answering wrongly if used before attachment.
 */
export class DeferredPayrollDispatcher implements Asking {
  private dispatcher: Dispatcher | undefined;

  public attach(dispatcher: Dispatcher): void {
    this.dispatcher = dispatcher;
  }

  public ask<TResult>(query: Query): Promise<Result<TResult, HandlerFailure>> {
    return this.attached().ask<TResult>(query);
  }

  public send<TResult>(command: Command): Promise<Result<TResult, HandlerFailure>> {
    return this.attached().send<TResult>(command);
  }

  private attached(): Dispatcher {
    if (this.dispatcher === undefined) {
      throw new Error(
        'Payroll was used before the dispatcher was attached. The composition root must call attach().',
      );
    }
    return this.dispatcher;
  }
}

/** Everything Payroll needs, assembled. Registered by the identity module's composition. */
export const payrollModuleFor = (
  unitOfWork: UnitOfWork,
  dispatcher: DeferredPayrollDispatcher,
): WorkModule =>
  payrollModule({
    unitOfWork,
    stores: postgresPayrollStores(),
    employment: new PayrollEmploymentSource(dispatcher),
    compensation: new PayrollCompensationSource(dispatcher),
    attendance: new PayrollAttendanceSource(dispatcher),
    leave: new PayrollLeaveSource(dispatcher),
    organization: new PayrollOrganizationSource(dispatcher),
    // The only `CountryRulePort` that exists. It returns nothing for every country, which is the
    // correct behaviour for a product with no country pack (ADR-0067).
    countryRules: noCountryRules,
    clock: systemClock,
  });
