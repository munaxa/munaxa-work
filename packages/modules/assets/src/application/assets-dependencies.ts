import type { UnitOfWork } from '@work/kernel';

import type { AssetsStores } from './assets-ports.js';

/**
 * Everything this module needs from outside itself, in one place.
 *
 * **Two, and the absences are the design.** Checkpoint 1's approved scope has zero cross-module
 * dependencies, so there is nothing here to reach another module with.
 *
 * There is no `EmploymentDirectoryPort`, because nothing in this checkpoint references an employment
 * — the first one arrives with custody, on the `RelationsEmploymentDirectory` template. There is no
 * `DocumentReferencePort`: D-5.3-04 settled *how* an asset would reference a document, and an
 * identifier column nothing reads is the stored flag ADR-0070 names. There is no `ApprovalPort`,
 * because a catalogue approves nothing and consuming one merely because it exists is how an unused
 * seam becomes load-bearing. There is no `StoragePort` — no adapter exists anywhere in this
 * repository. There is no `NotificationPort`: nothing here tells anybody anything. There is **no
 * `JobPort`** — nothing in this module is scheduled, and declaring one would imply it could be.
 *
 * There is no `PermissionChecker` either, and unlike Relations' there is no reason there would be:
 * every payload this module publishes is reached by exactly one permission, so there is no second
 * disclosure inside a response for a handler to assemble from what the caller holds. The pipeline
 * settles authorization before a handler runs.
 *
 * There is no `Clock`. Nothing in Checkpoint 1 records an instant a caller could disagree with:
 * audit timestamps are written by `@work/persistence` at the moment of insert, and no business date
 * is stored at all.
 */
export interface AssetsDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly stores: AssetsStores;
}
