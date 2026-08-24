import { assetsModule, postgresAssetsStores } from '@work/assets';
import { systemClock } from '@work/payroll';
import type { UnitOfWork, WorkModule } from '@work/kernel';

import type { Asking } from '../payroll/asking.js';
import { AssetsEmploymentDirectory } from './assets-sources.js';

/**
 * Assets & Custody's composition: the PostgreSQL stores, one cross-module adapter, and a clock.
 *
 * **Three dependencies, and every absence is still the design.** Checkpoint 1 had one — the stores —
 * and was the shortest composition in the repository. Checkpoint 2 adds exactly two, because custody
 * needs two things Checkpoint 1 did not: an employment that is real, and a day that is genuinely
 * today.
 *
 * The employment directory reaches a query Employment **already publishes**, under a bounded grant,
 * and learns one boolean. No Employment change, no new contract, and nothing about the person.
 *
 * `systemClock` comes from `@work/payroll` because it is the only exported system clock in the
 * repository and every module that needs one already uses it. Duplicating it per module is how two
 * clocks come to disagree.
 *
 * There is no document adapter: D-5.3-04 settled *how* an asset would reference a document, and an
 * identifier column nothing reads is the stored flag ADR-0070 names. There is no approval port,
 * because nothing here needs approving — and consuming `ApprovalPort` merely because it exists is how
 * a seam nobody uses becomes load-bearing. There is no storage adapter, no notification port, and
 * **no `JobPort`**: nothing here is scheduled, and wiring one would imply it could be.
 *
 * There is no permission checker. Every payload this module publishes is reached by exactly one
 * permission, so there is no second disclosure inside a response for a handler to assemble from what
 * the caller holds — the pipeline settles authorization before a handler runs.
 *
 * The dispatcher parameter is typed `Asking` — the narrowest interface this module needs — rather than
 * the deferred payroll dispatcher the caller happens to pass. Assets only ever *asks*: it sends no
 * cross-module command, and a wider type here would suggest it could.
 */
export const assetsModuleFor = (unitOfWork: UnitOfWork, dispatcher: Asking): WorkModule =>
  assetsModule({
    unitOfWork,
    stores: postgresAssetsStores(),
    employments: new AssetsEmploymentDirectory(dispatcher),
    clock: systemClock,
  });
