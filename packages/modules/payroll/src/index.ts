/**
 * `@work/payroll` — what is actually paid for a period.
 *
 * What this package exports is deliberately narrow: the published contracts other modules and the
 * composition root may depend on, and nothing that would let a caller reach past them.
 *
 * The five **source ports are exported as types only**. The composition root implements them against
 * the owning modules' published queries under bounded service grants (ADR-0043); a concrete adapter
 * exported from here would be Payroll deciding how Employment, Attendance, Leave, Compensation and
 * Organization are reached.
 *
 * `leaveUnavailable` and `attendanceUnavailable` **are** exported, because they are the honest
 * adapters for a composition without those contracts — they answer "unknown" rather than "nothing",
 * so a missing capability produces a recorded reason instead of a silent zero.
 *
 * `noCountryRules` is exported and is the only `CountryRulePort` that exists. It returns nothing for
 * every country, which is the correct behaviour for a product with no country pack (ADR-0067).
 */

export * from './contracts/index.js';

export { payrollModule } from './application/payroll-module.js';
export { ALL_PAYROLL_PERMISSIONS, PayrollPermissions } from './application/payroll-permissions.js';
export type { PayrollPermission } from './application/payroll-permissions.js';

export {
  attendanceUnavailable,
  leaveUnavailable,
  sourceAnswered,
  sourceUnavailable,
  systemClock,
} from './application/cross-module-ports.js';
export type {
  AttendanceSourcePort,
  Clock,
  CompensationSourcePort,
  EmploymentSourcePort,
  LeaveSourcePort,
  LegalEntityForPayroll,
  OrganizationSourcePort,
  PeriodWindow,
  SourceAnswer,
} from './application/cross-module-ports.js';

export type { PayrollDependencies } from './application/payroll-dependencies.js';
export type { PayrollStores } from './application/payroll-ports.js';

export { noCountryRules } from './domain/country-rule.js';
export type {
  CountryRuleInput,
  CountryRuleLine,
  CountryRuleOutput,
  CountryRulePort,
} from './domain/country-rule.js';

export { CALCULATION_VERSION } from './domain/payroll-calculation.js';
export type {
  AttendanceFacts,
  CompensationCurrencyFacts,
  CompensationFacts,
  EmploymentFacts,
  EmploymentSnapshot,
  LeaveFacts,
} from './domain/payroll-snapshot.js';
export type { MoneyAmount } from './domain/money-amount.js';

export { postgresPayrollStores } from './infrastructure/payroll-stores.js';
export { inMemoryPayrollStores } from './application/in-memory-stores.js';
export { FixedClock } from './application/payroll-test-harness.js';

/**
 * The HTTP edge. Registered by the API app's Payroll Nest module; nothing else imports it.
 *
 * Route ordering is load-bearing: `PayrollConfigurationController` declares only literal segments
 * and is registered before the controllers carrying `:parameter` segments at the same depth.
 */
export { PayrollDispatcher } from './api/payroll-dispatcher.js';
export { PayrollConfigurationController } from './api/configuration.controller.js';
export { PayrollRunController } from './api/run.controller.js';
export { PayrollDecisionController } from './api/decision.controller.js';
export { PayrollResultController } from './api/result.controller.js';
