import type { RelationsStores } from '../application/relations-ports.js';
import {
  PostgresAccessEventRepository,
  PostgresViolationCategoryRepository,
  PostgresViolationRepository,
} from './relations.repository.js';
import {
  PostgresCaseEventRepository,
  PostgresInvestigationRepository,
} from './investigation.repository.js';

/**
 * The real stores, assembled.
 *
 * A function returning the whole `RelationsStores` interface rather than a partial, so a repository
 * somebody forgot to write is a compile error rather than a runtime one — and in this module a
 * missing store would mean a violation recorded with no access trail behind it.
 */
export const postgresRelationsStores = (): RelationsStores => ({
  categories: new PostgresViolationCategoryRepository(),
  violations: new PostgresViolationRepository(),
  access: new PostgresAccessEventRepository(),
  investigations: new PostgresInvestigationRepository(),
  caseEvents: new PostgresCaseEventRepository(),
});
