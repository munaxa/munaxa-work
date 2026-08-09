/**
 * Onboarding — the process that carries a new employment from hire to a first working day.
 *
 * What this package exports is deliberately narrow: the public contracts other modules may depend
 * on, the composition pieces the API needs to wire the module up, and nothing else. Aggregates,
 * repositories and handlers stay internal.
 *
 * The two cross-module ports are exported as **types only**. The composition root implements them
 * against Employment and People under a bounded service grant (ADR-0043), which is what keeps
 * employment-register and person-register permissions off every HR administrator's role — and what
 * stops this module from ever importing another module's internals.
 *
 * Note what is absent from `EmploymentDirectoryPort`: there is no `create`. Recruitment's hire
 * creates the Person and the Employment (ADR-0046); Onboarding references them and could not create
 * either if it tried, because the instance's foreign keys would refuse the row (ADR-0047).
 */

export * from './contracts/index.js';

// Composition — what the API's composition root assembles.
export { onboardingModule } from './application/onboarding-module.js';
export {
  ALL_ONBOARDING_PERMISSIONS,
  OnboardingPermissions,
} from './application/onboarding-permissions.js';
export type { OnboardingPermission } from './application/onboarding-permissions.js';
export { systemClock } from './application/onboarding-ports.js';
export type {
  Clock,
  EmploymentDirectoryPort,
  EmploymentForOnboarding,
  OnboardingStores,
  PeopleDirectoryPort,
  PersonForOnboarding,
} from './application/onboarding-ports.js';
export type { OnboardingDependencies } from './application/onboarding-dependencies.js';
export type { CommandSender } from './application/transfer.use-case.js';
export { postgresOnboardingStores } from './infrastructure/onboarding-stores.js';

/**
 * The start command's shape, exported so a caller outside the HTTP edge can send it.
 *
 * This is what an accelerator wires to: a composition root may subscribe to a hire event and send
 * this command, and doing so changes nothing about the guarantee — the command is idempotent, so a
 * duplicate event costs a read and a delivered event that never arrives is picked up by
 * reconciliation instead (ADR-0050).
 */
export type { OnboardingStarted, StartOnboardingCommand } from './application/start.use-case.js';
export type {
  AwaitingOnboardingView,
  ReconciliationOutcome,
} from './application/reconcile.use-case.js';

// Transport — the controllers the API mounts.
export { OnboardingDispatcher } from './api/onboarding-dispatcher.js';
export { PlansController } from './api/plans.controller.js';
export { PlanVersionsController } from './api/plan-versions.controller.js';
export { OnboardingsController } from './api/onboardings.controller.js';
export { OnboardingLifecycleController } from './api/onboarding-lifecycle.controller.js';
export { TasksController } from './api/tasks.controller.js';
export {
  OnboardingExportController,
  ReconciliationController,
} from './api/reconciliation.controller.js';

/**
 * Test infrastructure.
 *
 * Exported deliberately, and named so it cannot be mistaken for production code: the API's endpoint
 * tests need the same stores and the same cross-module fakes this module's own tests use, and a fake
 * duplicated in two packages is a fake that will drift from the real thing in one of them.
 */
export { inMemoryOnboardingStores } from './application/in-memory-stores.js';
export { FakeEmployment, FakePeople } from './application/onboarding-test-harness.js';
