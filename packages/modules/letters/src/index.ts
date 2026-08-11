/**
 * Employee letters: tenant-authored templates, immutable template versions, generation from
 * published contracts, a frozen source snapshot, and issuance.
 *
 * This module **renders nothing**. No PDF service, template engine or signature provider exists in
 * this repository, so an issued letter carries its content and its snapshot and no artefact — the
 * part that is owned is the part that is reproducible.
 */
export * from './domain/letters-vocabulary.js';
export * from './domain/letters-rejection.js';
export * from './domain/letter-template.js';
export * from './domain/letter-generation.js';
export * from './domain/letter-approval.js';

export * from './contracts/views.js';

export { lettersModule } from './application/letters-module.js';
export { ALL_LETTERS_PERMISSIONS, LettersPermissions } from './application/letters-permissions.js';
export type { LettersPermission } from './application/letters-permissions.js';

export type { LettersDependencies } from './application/letters-dependencies.js';

/**
 * The source ports, as types — the composition root implements them against the owning modules'
 * published queries under bounded service grants (ADR-0043). A concrete adapter exported from here
 * would be Letters deciding how People, Employment, Organization, Compensation and Payroll are
 * reached.
 */
export type {
  Clock,
  LetterFilters,
  LetterSourcePort,
  LetterSources,
  LetterSubject,
  LettersStores,
  Page,
  Paged,
  ReconciliationFinding,
  SourceFacts,
  VerificationTokenPort,
} from './application/letters-ports.js';

export { inMemoryLettersStores } from './application/in-memory-stores.js';
export { FixedClock } from './application/letters-test-harness.js';

/**
 * The only `VerificationTokenPort` that exists, and the only code here that reaches a random source.
 *
 * Exported because a composition root has no honest alternative: a predictable token turns the
 * third-party authenticity check into a public register of who works where.
 */
export { randomVerificationToken } from './infrastructure/verification-token.js';

export { postgresLettersStores } from './infrastructure/letters-stores.js';
