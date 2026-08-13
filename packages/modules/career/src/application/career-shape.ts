import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { inMemoryCareerStores } from './in-memory-stores.js';
import type { CareerDependencies } from './career-dependencies.js';

/**
 * What the boundary suites need in order to assert about the *shape* of this module rather than
 * about its behaviour.
 *
 * Shared because three suites make the same kind of claim — "there is no such port", "there is no
 * such command", "that word appears nowhere in the code" — and a copy of this in each of them would
 * drift, leaving one suite still checking a boundary the others had stopped checking.
 */

const APPLICATION = new URL('.', import.meta.url).pathname;

/** Every application source file except the suites themselves. */
export const applicationSources = (): readonly { readonly name: string; readonly text: string }[] =>
  readdirSync(APPLICATION)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => ({ name, text: readFileSync(join(APPLICATION, name), 'utf8') }));

/**
 * The code with its comments removed.
 *
 * Comments are where this module *explains* what it refuses to do, so they name every forbidden
 * term deliberately — `criticality`, `potentialBand`, `nine_box`, `JobPort`. Stripping them is what
 * makes an absence assertion about the code rather than about the prose beside it.
 */
export const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/**
 * Dependencies for the assertions that never dispatch anything.
 *
 * Every port answers "no" and the unit of work rejects, because these suites read the module's
 * declaration rather than running it. A double that *worked* here would invite a behavioural
 * assertion into a file whose job is to check what the module is made of.
 */
export const shapeDependencies = (): CareerDependencies => ({
  unitOfWork: { execute: () => Promise.reject(new Error('not dispatched')) },
  stores: inMemoryCareerStores(),
  employment: { factsFor: () => Promise.resolve(undefined), inPosition: () => Promise.resolve([]) },
  organization: {
    positionExists: () => Promise.resolve(false),
    unitExists: () => Promise.resolve(false),
  },
  learning: { assignmentExists: () => Promise.resolve(false) },
  permissions: { holds: () => Promise.resolve(false) },
  clock: { now: () => new Date('2026-08-13T09:00:00Z') },
});
