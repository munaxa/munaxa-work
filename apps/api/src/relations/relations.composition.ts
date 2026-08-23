import { systemClock } from '@work/payroll';
import { postgresRelationsStores, relationsModule } from '@work/relations';
import type { PermissionChecker, UnitOfWork, WorkModule } from '@work/kernel';

import type { Asking } from '../payroll/asking.js';
import { RelationsEmploymentDirectory, RelationsMembershipDirectory } from './relations-sources.js';

/**
 * Employee Relations' composition: the PostgreSQL stores, two cross-module adapters, and a clock.
 *
 * **Four dependencies, and the absences are the design.** Checkpoint 2 added one — Identity's
 * membership standing, so an investigator named on a command is verified rather than accepted. It
 * reaches a query Identity already published, under a bounded grant, and learns one boolean.
 *
 * There is no storage adapter — evidence
 * attachment is a later decision and no `StoragePort` adapter exists anywhere in this repository.
 * There is no notification port: nothing here tells anybody anything, and delivery is Phase 17's.
 * There is no approval port, because Checkpoint 1 issues nothing that needs approving. There is no
 * `JobPort`: nothing in this module is scheduled, and wiring one would imply it could be.
 *
 * `systemClock` comes from `@work/payroll` because it is the only exported system clock in the
 * repository and every module that needs one already uses it. Duplicating it per module is how two
 * clocks come to disagree.
 *
 * The dispatcher parameter is typed `Asking` — the narrowest interface this module needs — rather
 * than the deferred payroll dispatcher the caller happens to pass. Relations only ever *asks*: it
 * sends no cross-module command, and a wider type here would suggest it could.
 */
export const relationsModuleFor = (
  unitOfWork: UnitOfWork,
  dispatcher: Asking,
  permissions: PermissionChecker,
): WorkModule =>
  relationsModule({
    unitOfWork,
    stores: postgresRelationsStores(),
    employments: new RelationsEmploymentDirectory(dispatcher),
    memberships: new RelationsMembershipDirectory(dispatcher),
    // The pipeline's own checker, not a second one. Used for exactly one question: may this caller
    // see an investigation's findings (D-5.2-18)?
    permissions,
    clock: systemClock,
  });
