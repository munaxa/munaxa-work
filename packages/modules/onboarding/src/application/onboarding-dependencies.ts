import type { UnitOfWork } from '@work/kernel';

import type {
  Clock,
  EmploymentDirectoryPort,
  OnboardingStores,
  PeopleDirectoryPort,
} from './onboarding-ports.js';

/**
 * Everything this module's use cases need, injected once.
 *
 * Handlers are built by factory functions taking this, rather than resolving from a container inside
 * the handler. It costs a line of wiring and buys handlers testable against fakes with no framework
 * present — the difference between a reconciliation test that runs in milliseconds and one that needs
 * a database, a Nest module and two other domains to start.
 *
 * `employment` and `people` are **ports, not imports of those modules**. Onboarding depends on both,
 * and the dependency runs through their published application services under a bounded service grant
 * (ADR-0043) — so an HR administrator is authorized for the onboarding operation and the *module*
 * holds the narrow cross-domain read, rather than every HR user holding permission over the
 * employment register.
 *
 * There is deliberately **no `ApprovalPort`**: the shipped adapter approves automatically, and an
 * approval nobody made is not an approval (ADR-0045). An `approval`-kind task records a decision by a
 * named human, and Phase 16 routes it without reshaping the task.
 *
 * There is deliberately **no `NotificationPort`**: the contract addresses a workforce user, and a
 * joiner on their first week may not have one yet — the same limitation Recruitment documented for
 * candidates. Onboarding raises domain events; Communications (Phase 17) subscribes when it can
 * address a recipient.
 *
 * There is deliberately **no `DocumentPort`**: no adapter implements it anywhere in this repository.
 * A `document` task records a *reference*, and the completion report says so rather than claiming
 * document upload works.
 */
export interface OnboardingDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly stores: OnboardingStores;
  readonly employment: EmploymentDirectoryPort;
  readonly people: PeopleDirectoryPort;
  readonly clock: Clock;
}
