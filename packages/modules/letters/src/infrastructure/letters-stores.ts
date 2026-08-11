import {
  PostgresApprovalDecisionRepository,
  PostgresIssuedLetterRepository,
  PostgresLetterRequestRepository,
} from './letter.repository.js';
import { PostgresNumberSequenceRepository } from './number-sequence.repository.js';
import {
  PostgresTemplateRepository,
  PostgresTemplateVersionRepository,
} from './template.repository.js';
import { PostgresLettersReconciliationRepository } from './reconciliation.repository.js';
import type { LettersStores } from '../application/letters-ports.js';

/**
 * The PostgreSQL stores, assembled.
 *
 * The composition root asks for these and gets the same interfaces the in-memory stores implement,
 * so no handler knows which it is talking to.
 */
export const postgresLettersStores = (): LettersStores => ({
  templates: new PostgresTemplateRepository(),
  templateVersions: new PostgresTemplateVersionRepository(),
  requests: new PostgresLetterRequestRepository(),
  issued: new PostgresIssuedLetterRepository(),
  decisions: new PostgresApprovalDecisionRepository(),
  numbers: new PostgresNumberSequenceRepository(),
  reconciliation: new PostgresLettersReconciliationRepository(),
});
