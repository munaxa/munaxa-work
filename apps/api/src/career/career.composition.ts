import type { PermissionChecker, UnitOfWork, WorkModule } from '@work/kernel';
import { careerModule, postgresCareerStores } from '@work/career';
import { systemClock } from '@work/payroll';

import type { Asking } from '../payroll/asking.js';
import { CareerEmployment, CareerLearning, CareerOrganization } from './career-sources.js';

/**
 * Career's composition: three cross-module adapters and the PostgreSQL stores.
 *
 * **Every dependency here is real.** There is no in-memory store, no auto-approving port, no
 * recording notification port and no fabricated identity resolver anywhere in this function — and
 * the module's own type would not let one in unnoticed, because `postgresCareerStores()` returns the
 * whole `CareerStores` interface rather than a partial.
 *
 * **Three adapters, and the absences are the design.**
 *
 * *No Performance adapter* — a nine-box band beside a nomination needs a filtered, paged placement
 * read that was not authorized (D-5), and the unpaged `talent-matrix` per nomination would be an
 * unbounded read. `NOT VERIFIED`.
 *
 * *No Documents adapter* — Career's schema has nowhere to persist an evidence identifier, so
 * confirming one and discarding it would be validation theatre (Checkpoint 4). `NOT VERIFIED`.
 *
 * *No notification port* — Learning composes a `RecordingNotificationPort` because it has moments
 * worth recording an intent for. Career has none: nothing here becomes due, nothing expires by
 * itself, and a recorded intent nobody reads is a "sent" state waiting to be misread.
 * `NOT VERIFIED`.
 *
 * *No `JobPort`* — a succession review comes due because somebody ran a query, and a mobility
 * recommendation expires by being read against a stated day. Both are derived at the boundary and
 * neither is scheduled. `NOT VERIFIED`.
 *
 * `systemClock` comes from `@work/payroll` because it is the only exported system clock in the
 * repository and every module that needs one already uses it. Duplicating it per module is how two
 * clocks come to disagree — and in this module a disagreeing clock is a recommendation reported
 * expired on the wrong day.
 */
export const careerModuleFor = (
  unitOfWork: UnitOfWork,
  // `Asking` rather than the deferred dispatcher class: the three adapters read and none of them
  // writes, so a parameter that could `send` would be authority this module has no use for. Career
  // recommends and executes nothing (ADR-0072), and the type of this parameter is part of how.
  dispatcher: Asking,
  permissions: PermissionChecker,
): WorkModule =>
  careerModule({
    unitOfWork,
    stores: postgresCareerStores(),
    employment: new CareerEmployment(dispatcher),
    organization: new CareerOrganization(dispatcher),
    learning: new CareerLearning(dispatcher),
    permissions,
    clock: systemClock,
  });
