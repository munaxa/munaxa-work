import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The file tree the Workflow audits read, and the two ways they read a file.
 *
 * Extracted from `workflow.audit.spec.ts` at the file-size budget when Phase 16C added its
 * authorized-capability assertions, and the seam is a real one: everything here is *how to find and
 * normalize the module's source*, while the spec beside it is *what must be true of it*. Sharing it
 * also means a second audit suite cannot quietly disagree about which files count as production.
 *
 * **The discovery is from the filesystem, never a list.** A file added tomorrow is audited tomorrow,
 * which is the property that makes a negative-space audit worth running at all.
 */

export const ROOT = join(process.cwd(), '..', '..', 'packages', 'modules', 'workflow', 'src');
export const LAYERS = ['domain', 'application', 'infrastructure', 'api', 'contracts'];

const isTest = (file: string): boolean => file.includes('.test.') || file.includes('.spec.');
const isFixture = (file: string): boolean =>
  file.includes('fixture') || file.includes('test-harness') || file.includes('scenarios');

const filesIn = (layer: string, wanted: (file: string) => boolean): readonly string[] =>
  readdirSync(join(ROOT, layer))
    .filter((file) => file.endsWith('.ts') && wanted(file))
    .map((file) => join(layer, file));

/** Every production file of the module: no test, no fixture, no harness. */
export const PRODUCTION = LAYERS.flatMap((layer) =>
  filesIn(layer, (file) => !isTest(file) && !isFixture(file)),
);

/** And every test file of the module, for the hygiene assertions. */
export const TESTS = LAYERS.flatMap((layer) => filesIn(layer, isTest));

/**
 * Source with block comments, line comments and string literals removed.
 *
 * This module *documents* its absences — the vocabulary names SLA and escalation to say what there
 * is and is not, the ports file names `JobPort` to say there is no port, and the Admin screen renders
 * sentences about every one of them. Prose is not implementation, and an audit that could not tell
 * them apart would force the code to stop explaining itself.
 */
export const codeOf = (file: string): string =>
  readFileSync(join(ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');

/** The same file with its prose intact, for the assertions that are about the text. */
export const textOf = (file: string): string => readFileSync(join(ROOT, file), 'utf8');
