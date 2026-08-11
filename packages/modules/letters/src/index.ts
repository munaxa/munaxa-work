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
