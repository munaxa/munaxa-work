import { assetsModule, postgresAssetsStores } from '@work/assets';
import type { UnitOfWork, WorkModule } from '@work/kernel';

/**
 * Assets & Custody's composition: the PostgreSQL stores, and nothing else.
 *
 * **One dependency, and every absence is the design.** Checkpoint 1's approved scope has zero
 * cross-module dependencies, so this is the shortest composition in the repository and it should
 * stay that way until custody genuinely needs Employment.
 *
 * There is no employment directory — nothing in this checkpoint references an employment, and the
 * first one arrives with custody on the `RelationsEmploymentDirectory` template. There is no document
 * adapter: D-5.3-04 settled *how* an asset would reference a document, and an identifier column
 * nothing reads is the stored flag ADR-0070 names. There is no approval port, because a catalogue
 * approves nothing — and consuming `ApprovalPort` merely because it exists is how a seam nobody uses
 * becomes load-bearing. There is no storage adapter, no notification port, and **no `JobPort`**:
 * nothing here is scheduled, and wiring one would imply it could be.
 *
 * There is no permission checker either. Every payload this module publishes is reached by exactly
 * one permission, so there is no second disclosure inside a response for a handler to assemble from
 * what the caller holds — the pipeline settles authorization before a handler runs.
 *
 * There is no clock: nothing in Checkpoint 1 records a business instant, and the audit timestamps are
 * written by `@work/persistence` at the moment of insert.
 */
export const assetsModuleFor = (unitOfWork: UnitOfWork): WorkModule =>
  assetsModule({
    unitOfWork,
    stores: postgresAssetsStores(),
  });
