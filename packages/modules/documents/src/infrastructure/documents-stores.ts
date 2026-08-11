import {
  PostgresDocumentRepository,
  PostgresDocumentTypeRepository,
} from './document.repository.js';
import {
  PostgresAccessEventRepository,
  PostgresVerificationRepository,
  PostgresVersionRepository,
} from './version.repository.js';
import { PostgresReconciliationRepository } from './reconciliation.repository.js';
import type { DocumentsStores } from '../application/documents-ports.js';

/**
 * The PostgreSQL stores, assembled.
 *
 * The composition root asks for these and gets the same interfaces the in-memory stores implement,
 * so no handler knows which it is talking to.
 */
export const postgresDocumentsStores = (): DocumentsStores => ({
  types: new PostgresDocumentTypeRepository(),
  documents: new PostgresDocumentRepository(),
  versions: new PostgresVersionRepository(),
  verifications: new PostgresVerificationRepository(),
  access: new PostgresAccessEventRepository(),
  reconciliation: new PostgresReconciliationRepository(),
});
