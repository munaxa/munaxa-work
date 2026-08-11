import type { PermissionChecker, UnitOfWork } from '@work/kernel';

import type {
  Clock,
  DocumentsStores,
  OwnerDirectoryPort,
  PersonIdentifierPort,
  StorageAccessPort,
} from './documents-ports.js';

/**
 * Everything this module needs from outside itself, in one place.
 *
 * **Four ports and no more.** Documents reads owners through a published contract, reads People's
 * identifier facts through another, and reaches storage through a third that currently has nothing
 * behind it. There is no `NotificationPort` consumer, no `JobPort`, no renderer and no signature
 * provider — none exists in this repository, and declaring one would imply this module could use it
 * (§57 of the plan).
 *
 * `permissions` is here for the same reason People has it: a search assembles its answer from what
 * the caller holds, rather than refusing outright. Someone who may read the register but not its
 * confidential documents receives the rest, and the module has to *ask* to know that.
 */
export interface DocumentsDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly stores: DocumentsStores;
  readonly owners: OwnerDirectoryPort;
  readonly identifiers: PersonIdentifierPort;
  readonly storage: StorageAccessPort;
  readonly permissions: PermissionChecker;
  readonly clock: Clock;
}
