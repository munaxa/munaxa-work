import type { UnitOfWork } from '@work/kernel';

import type {
  AttendanceStores,
  Clock,
  EmploymentDirectoryPort,
  LeaveDirectoryPort,
} from './attendance-ports.js';

/**
 * Everything this module's use cases need, injected once.
 *
 * Handlers are built by factory functions taking this, rather than resolving from a container
 * inside the handler. It costs a line of wiring and buys handlers testable against fakes with no
 * framework present — the difference between a calculation test that runs in milliseconds and one
 * that needs a database, a Nest module and two other domains to start.
 *
 * `employment` and `leave` are **ports, not imports of those modules**. Employment's runs through
 * its published application service under a bounded service grant (ADR-0043), so a shift supervisor
 * reviewing a rota does not thereby become a reader of the employment register.
 *
 * There is deliberately **no `ApprovalPort`**: the shipped adapter approves automatically, and an
 * approval nobody made is not an approval (ADR-0045). A correction records the decision of a named
 * human, and Phase 16 routes it without reshaping the request.
 *
 * There is deliberately **no `NotificationPort`**: the contract addresses a workforce user, and a
 * shift worker punching at a turnstile may not have one. Attendance raises domain events;
 * Communications (Phase 17) subscribes when it can address a recipient.
 *
 * There is deliberately **no `DocumentPort`**: no adapter implements it anywhere in this
 * repository. Evidence against an absence is a *reference*, and the completion report says so
 * rather than claiming document upload works.
 *
 * There is deliberately **no location or site port**. There is no work-location model in this
 * product, ADR-0041 explains why inventing one here would be worse than the gap, and a geofence
 * with nothing authoritative to verify against would be a claim rather than a check (ADR-0055).
 */
export interface AttendanceDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly stores: AttendanceStores;
  readonly employment: EmploymentDirectoryPort;
  readonly leave: LeaveDirectoryPort;
  readonly clock: Clock;
}
