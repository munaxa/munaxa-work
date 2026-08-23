import type { UnitOfWork } from '@work/kernel';

import type { Clock, EmploymentDirectoryPort, RelationsStores } from './relations-ports.js';

/**
 * Everything this module needs from outside itself, in one place.
 *
 * **Three, and no more.** There is no `StoragePort` — evidence attachment is a later decision
 * (D-5.2-08) and no adapter exists anywhere in this repository to attach to. There is no
 * `NotificationPort`: nothing here tells anybody anything, and delivery is Phase 17's. There is no
 * `ApprovalPort`, because Checkpoint 1 issues nothing that needs approving. There is **no `JobPort`**
 * — nothing in this module is scheduled, and declaring one would imply it could be.
 *
 * There is also no `PermissionChecker`. Documents needs one because its search assembles an answer
 * from what the caller holds; nothing here does that. A caller either may read a violation or may
 * not, and the pipeline settles it before a handler runs.
 */
export interface RelationsDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly stores: RelationsStores;
  readonly employments: EmploymentDirectoryPort;
  readonly clock: Clock;
}
