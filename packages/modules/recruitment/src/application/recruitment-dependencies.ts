import type { UnitOfWork } from '@work/kernel';

import type {
  Clock,
  EmploymentDirectoryPort,
  OrganizationDirectoryPort,
  PeopleDirectoryPort,
  RecruitmentStores,
} from './recruitment-ports.js';

/**
 * Everything this module's use cases need, injected once.
 *
 * Handlers are built by factory functions taking this, rather than resolving from a container
 * inside the handler. It costs a line of wiring and buys handlers testable against fakes with no
 * framework present — the difference between a hire-saga test that runs in milliseconds and one
 * that needs a database, a Nest module and two other domains to start.
 *
 * `people`, `organization` and `employment` are **ports, not imports of those modules**.
 * Recruitment depends on all three, and the dependency runs through their published application
 * services under a bounded service grant (ADR-0043) — so a recruiter is authorized for the
 * recruitment operation and the *module* holds the narrow cross-domain permission, rather than
 * every recruiter holding permission to edit the master registry of human identity.
 *
 * There is deliberately **no `NotificationPort` here**, and the completion report says so rather
 * than claiming candidate email works. The kernel's contract addresses a **workforce user**, and
 * neither party Recruitment would write to is one: a candidate is not a user of this product at all
 * — that is the whole point of ADR-0044 — and an interviewer is an *employment*, which carries no
 * user identity in Phase 5's model. Addressing either would mean widening the bounded cross-module
 * contract to resolve people into login accounts (A-1), for a delivery adapter that records rather
 * than sends. Recruitment raises the domain events instead; Communications (Phase 17) subscribes to
 * them when it can actually address a recipient.
 *
 * There is deliberately **no `ApprovalPort` here**. The shipped adapter auto-approves, and an
 * approval nobody made is not an approval of a control that authorizes headcount spending
 * (ADR-0045). Recruitment records a real decision by a named human, and Phase 16 replaces the
 * routing without reshaping the aggregate.
 */
export interface RecruitmentDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly stores: RecruitmentStores;
  readonly people: PeopleDirectoryPort;
  readonly organization: OrganizationDirectoryPort;
  readonly employment: EmploymentDirectoryPort;
  readonly clock: Clock;
}
