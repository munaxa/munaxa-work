import { documentsModule, postgresDocumentsStores, storageUnavailable } from '@work/documents';
import { systemClock } from '@work/payroll';
import type { PermissionChecker, UnitOfWork, WorkModule } from '@work/kernel';

import type { DeferredPayrollDispatcher } from '../payroll/payroll.composition.js';
import { DocumentsOwnerDirectory, DocumentsPersonIdentifiers } from './documents-sources.js';

/**
 * Documents' composition: two cross-module adapters, the PostgreSQL stores, and **no storage**.
 *
 * `storageUnavailable` is not a fake and not a stub. A fake would return a URL; this returns nothing
 * and says `available: false`, which is the difference between "the capability is not wired" and
 * "the capability is broken". It is the only `StorageAccessPort` in this repository, because there
 * is no object store to wire — and inventing one here would put a fabricated link in front of a
 * caller expecting a passport scan.
 *
 * `systemClock` comes from `@work/payroll` because it is the only exported system clock in the
 * repository and every module that needs one already uses it. Duplicating it per module is how two
 * clocks come to disagree.
 */
export const documentsModuleFor = (
  unitOfWork: UnitOfWork,
  dispatcher: DeferredPayrollDispatcher,
  permissions: PermissionChecker,
): WorkModule =>
  documentsModule({
    unitOfWork,
    stores: postgresDocumentsStores(),
    owners: new DocumentsOwnerDirectory(dispatcher),
    identifiers: new DocumentsPersonIdentifiers(dispatcher),
    // No adapter exists. Reported honestly at every edge; never a fabricated URL.
    storage: storageUnavailable,
    permissions,
    clock: systemClock,
  });
