import { DocumentsPermissions } from './documents-permissions.js';
import type { DocumentState } from '../domain/document.js';
import type { DocumentsDependencies } from './documents-dependencies.js';

/**
 * Whether a confidential document must be hidden from the caller.
 *
 * One function rather than the same two lines in three handlers, because the rule has to be
 * identical everywhere it applies: `document.read` and `document.download` reach ordinary and
 * internal documents; a confidential one needs `document.read-sensitive` as well.
 *
 * Callers turn a `true` here into **not found**, never forbidden. "Forbidden" on a document
 * identifier confirms that a document of that kind exists for that employee, and in this module that
 * confirmation is itself the disclosure — a manager learning that a medical certificate exists has
 * learned the thing the confidentiality level was protecting.
 */
export const hiddenFromCaller = async (
  dependencies: DocumentsDependencies,
  document: DocumentState,
): Promise<boolean> => {
  if (document.confidentiality !== 'confidential') return false;

  return !(await dependencies.permissions.holds(DocumentsPermissions.readSensitive));
};
