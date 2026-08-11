export { isEntityCode } from '../domain/performance-vocabulary.js';

/**
 * A tenant-authored name, in both languages this product ships.
 *
 * The *shape* is an application concern and the *content* is a tenant's: nothing in this module
 * translates a competency somebody wrote, and nothing here supplies a default for the language a
 * tenant left empty. The catalogue keys that do get translated are the refusal messages, and those
 * carry keys rather than sentences (§17 of the plan).
 */
export interface LocalizedNameInput {
  readonly en: string;
  readonly ar: string;
}
