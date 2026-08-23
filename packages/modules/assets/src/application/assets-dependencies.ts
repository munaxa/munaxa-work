import type { UnitOfWork } from '@work/kernel';

import type { AssetsStores, Clock, EmploymentDirectoryPort } from './assets-ports.js';

/**
 * Everything this module needs from outside itself, in one place.
 *
 * **Four, and the absences are still the design.** Checkpoint 1 had two; Checkpoint 2 adds exactly
 * two, and states why each is unavoidable.
 *
 * **`employments`** is the module's only cross-module dependency. Custody references Employment
 * (AD-001), so an employment named on a command has to be confirmed real before a row claims somebody
 * holds company property. It reaches a read Employment **already publishes**, under a bounded grant,
 * and learns one boolean. No Employment change, no new contract.
 *
 * **`clock`** arrived with custody because custody records days. Checkpoint 1 stored no business date
 * and needed none; a handover has one, and a caller who could supply "today" could date a return
 * before it happened. It is the same `systemClock` every module uses.
 *
 * There is still no `DocumentReferencePort`: D-5.3-04 settled *how* an asset would reference a
 * document, and an identifier column nothing reads is the stored flag ADR-0070 names. There is no
 * `ApprovalPort`, because nothing here needs approving and consuming one merely because it exists is
 * how an unused seam becomes load-bearing. There is no `StoragePort` — no adapter exists anywhere in
 * this repository. There is no `NotificationPort`: nothing here tells anybody anything. There is **no
 * `JobPort`** — nothing in this module is scheduled, and declaring one would imply it could be.
 *
 * There is no `PermissionChecker`, and unlike Relations' there is no reason there would be: every
 * payload this module publishes is reached by exactly one permission, so there is no second disclosure
 * inside a response for a handler to assemble from what the caller holds. The pipeline settles
 * authorization before a handler runs.
 */
export interface AssetsDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly stores: AssetsStores;
  readonly employments: EmploymentDirectoryPort;
  readonly clock: Clock;
}
