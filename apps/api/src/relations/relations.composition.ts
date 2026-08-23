import { systemClock } from '@work/payroll';
import { postgresRelationsStores, relationsModule } from '@work/relations';
import type { UnitOfWork, WorkModule } from '@work/kernel';

import type { Asking } from '../payroll/asking.js';
import { RelationsEmploymentDirectory } from './relations-sources.js';

/**
 * Employee Relations' composition: the PostgreSQL stores, one cross-module adapter, and a clock.
 *
 * **Three dependencies, and the absences are the design.** There is no storage adapter — evidence
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
export const relationsModuleFor = (unitOfWork: UnitOfWork, dispatcher: Asking): WorkModule =>
  relationsModule({
    unitOfWork,
    stores: postgresRelationsStores(),
    employments: new RelationsEmploymentDirectory(dispatcher),
    clock: systemClock,
  });
