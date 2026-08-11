import { EXPOSABLE_FIELDS, type ExposableField } from '../domain/letters-vocabulary.js';
import { accept, refuse, type LettersResult } from '../domain/letters-rejection.js';
import type { LetterTemplateVersionState } from '../domain/letter-template.js';
import type { ResolvedValues, SourceVersions } from '../domain/letter-generation.js';
import type { LetterSources, LetterSubject } from './letters-ports.js';

/**
 * Turning a template's declared variables into values, by asking the modules that own them.
 *
 * Four rules, and each of them is a refusal rather than a silence.
 *
 * **A variable names a source.** `employment.startDate` is resolved by asking Employment for
 * `startDate`. A variable whose prefix is not an exposable field is refused when the template is
 * generated from, not rendered as literal text.
 *
 * **The template must expose the field.** A declared variable whose prefix is absent from
 * `exposedFields` is refused — the template author's own allow-list is a gate, not documentation.
 *
 * **A source that cannot be asked fails the letter.** `undefined` from a port is an outage, and an
 * outage is not "no facts": rendering a blank where a salary belongs is how a bank letter comes to
 * state that an employee earns nothing, over the employer's name.
 *
 * **An unresolved name fails the letter.** Same reason. The domain refuses it again at substitution.
 *
 * What comes back is the values *and* the version of each source they came from. Both are frozen on
 * issue, which is what makes a March salary certificate still read March's salary after April's
 * raise — Payroll's ADR-0064 argument, applied to letters.
 */

export interface Resolution {
  readonly resolved: ResolvedValues;
  readonly sourceVersions: SourceVersions;
}

export const resolveVariables = async (
  version: LetterTemplateVersionState,
  sources: LetterSources,
  subject: LetterSubject,
): Promise<LettersResult<Resolution>> => {
  const needed = neededFields(version);

  if (!needed.ok) return needed;

  const answers = await answersFor(needed.value, sources, subject);

  if (!answers.ok) return answers;

  return valuesFor(version, answers.value);
};

/** Which sources this version's variables actually require, checked against its own allow-list. */
const neededFields = (
  version: LetterTemplateVersionState,
): LettersResult<readonly ExposableField[]> => {
  const needed = new Set<ExposableField>();

  for (const variable of version.variables) {
    const prefix = variable.split('.')[0] ?? '';

    if (!(EXPOSABLE_FIELDS as readonly string[]).includes(prefix)) {
      return refuse('variable_source_unknown', { variable });
    }
    if (!version.exposedFields.includes(prefix as ExposableField)) {
      return refuse('variable_source_not_exposed', { variable });
    }
    needed.add(prefix as ExposableField);
  }
  return accept([...needed]);
};

type Answers = ReadonlyMap<
  ExposableField,
  { values: Readonly<Record<string, string>>; version: string }
>;

const answersFor = async (
  needed: readonly ExposableField[],
  sources: LetterSources,
  subject: LetterSubject,
): Promise<LettersResult<Answers>> => {
  const answers = new Map<
    ExposableField,
    { values: Readonly<Record<string, string>>; version: string }
  >();

  for (const field of needed) {
    const source = sources[field];

    // No port wired for a field the template needs. A composition that cannot answer is reported
    // as such; it is not a letter with a gap in it.
    if (source === undefined) return refuse('source_not_configured', { source: field });

    const facts = await source.factsFor(subject);

    // `undefined` is an outage, not an empty answer.
    if (facts === undefined) return refuse('source_unavailable', { source: field });
    answers.set(field, { values: facts.values, version: facts.sourceVersion });
  }
  return accept(answers);
};

const valuesFor = (
  version: LetterTemplateVersionState,
  answers: Answers,
): LettersResult<Resolution> => {
  const resolved: Record<string, string> = {};
  const sourceVersions: Record<string, string> = {};

  for (const variable of version.variables) {
    const [prefix = '', ...rest] = variable.split('.');
    const answer = answers.get(prefix as ExposableField);
    const value = answer?.values[rest.join('.')];

    if (answer === undefined || value === undefined) {
      // The variable name travels; the resolved values never do (see `LettersRejection`).
      return refuse('variable_unresolved', { variable });
    }
    resolved[variable] = value;
    sourceVersions[prefix] = answer.version;
  }
  return accept({ resolved, sourceVersions });
};
