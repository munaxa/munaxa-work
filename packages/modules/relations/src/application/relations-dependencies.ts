import type { PermissionChecker, UnitOfWork } from '@work/kernel';

import type {
  Clock,
  EmploymentDirectoryPort,
  MembershipDirectoryPort,
  RelationsStores,
} from './relations-ports.js';

/**
 * Everything this module needs from outside itself, in one place.
 *
 * **Five, and no more.** Checkpoint 3 added `permissions`; Checkpoint 2 added exactly one — `memberships`, so an investigator named on
 * a command is a membership that really may act rather than a string somebody typed. It reaches an
 * existing published query under a bounded grant and learns one boolean.
 *
 * There is no `StoragePort` — evidence attachment is a later decision
 * (D-5.2-08) and no adapter exists anywhere in this repository to attach to. There is no
 * `NotificationPort`: nothing here tells anybody anything, and delivery is Phase 17's. There is no
 * `ApprovalPort`, because Checkpoint 1 issues nothing that needs approving. There is **no `JobPort`**
 * — nothing in this module is scheduled, and declaring one would imply it could be.
 *
 * **`permissions` arrived with D-5.2-18 and it changed a stated assumption**, so the old reasoning is
 * corrected here rather than quietly deleted. Checkpoint 1 wrote that no `PermissionChecker` was
 * needed because *"a caller either may read a violation or may not, and the pipeline settles it
 * before a handler runs"*. That was true while every payload was equally sensitive. It stopped being
 * true when an inquiry's findings became a second disclosure inside a payload the same permission
 * already reached — so the answer is now assembled from what the caller holds, exactly as Documents'
 * search is, and the checker is the same one Documents receives rather than a second engine.
 */
export interface RelationsDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly stores: RelationsStores;
  readonly employments: EmploymentDirectoryPort;
  readonly memberships: MembershipDirectoryPort;
  /** The pipeline's own checker. Used for one question: may this caller see findings? */
  readonly permissions: PermissionChecker;
  readonly clock: Clock;
}
