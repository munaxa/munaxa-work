import type { UnitOfWork } from '@work/kernel';

import type {
  Clock,
  EmploymentDirectoryPort,
  MembershipDirectoryPort,
  RelationsStores,
} from './relations-ports.js';

/**
 * Everything this module needs from outside itself, in one place.
 *
 * **Four, and no more.** Checkpoint 2 added exactly one — `memberships`, so an investigator named on
 * a command is a membership that really may act rather than a string somebody typed. It reaches an
 * existing published query under a bounded grant and learns one boolean.
 *
 * There is no `StoragePort` — evidence attachment is a later decision
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
  readonly memberships: MembershipDirectoryPort;
  readonly clock: Clock;
}
