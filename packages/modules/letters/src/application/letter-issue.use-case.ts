import { success, uuidV7, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { generate, issueLetter, moveRequestTo } from '../domain/letter-generation.js';
import type { IssuedLetterState, LetterRequestState } from '../domain/letter-generation.js';
import type { LetterTemplateVersionState } from '../domain/letter-template.js';
import { conflicted, currentActor, notFound, refusedBy } from './letters-context.js';
import { LettersPermissions } from './letters-permissions.js';
import { resolveVariables } from './variable-resolution.js';
import type { LettersDependencies } from './letters-dependencies.js';

/**
 * Generating a letter and issuing it — one command, because a half-issued letter helps nobody.
 *
 * **The salary gate is here, and it is the second of two.** 5.1 AD-005 requires a template to be
 * permitted to expose salary *and* the requester to hold `letter.include-salary`. The template's
 * half is `exposedFields`; this is the caller's. Without it, a letter becomes a way to read a salary
 * the caller could not read directly — anybody who may request an employment certificate could
 * request one whose template happens to print a figure.
 *
 * **Everything that made the letter is frozen at issue**: the template version, every substituted
 * value, the locale, and the version of each source the values came from. A salary certificate
 * issued in March still reads March's salary after April's raise, because nothing re-reads a source
 * after issue — Payroll's ADR-0064 argument, for the same reason.
 *
 * **There is no rendered artefact.** No PDF library, renderer or headless browser exists in this
 * repository, so `documentId` is absent on every issued letter and rendering is `NOT VERIFIED`
 * (D-15). The letter's *content* is fully owned and reproducible without one; only the file is
 * missing, and it is recorded as missing rather than approximated.
 *
 * **Nothing here claims a signature.** A template may declare that one is required, and the letter
 * records `required`; no signature provider exists, so nothing may say one occurred (D-16).
 */

export interface IssueLetterCommand extends Command {
  readonly commandName: 'letters.issue';
  readonly letterRequestId: string;
  readonly signatory?: string;
  /** A correction: the letter this one replaces. The original is never overwritten. */
  readonly supersedesId?: string;
}

export interface LetterIssued {
  readonly issuedLetterId: string;
  readonly letterRequestId: string;
  readonly referenceNumber: string;
  readonly body: string;
}

/** One series per tenant, per D-20. Letters does not reuse Employment's counter. */
const SERIES_KEY = 'letter';

export const issueLetterHandler = (
  dependencies: LettersDependencies,
): CommandHandler<IssueLetterCommand, LetterIssued> => ({
  commandName: 'letters.issue',
  permission: LettersPermissions.issue,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await resolveRequest(dependencies, transaction, command.letterRequestId);

      if (!found.ok) return found.failure as ReturnType<typeof notFound<LetterIssued>>;

      const { request, version } = found;
      const permitted = await salaryPermitted(dependencies, version);

      if (!permitted) return conflicted<LetterIssued>('salary_exposure_not_permitted');

      return issueFrom(dependencies, transaction, request, version, command);
    }),
});

interface Resolved {
  readonly ok: true;
  readonly request: LetterRequestState;
  readonly version: LetterTemplateVersionState;
}

interface Unresolved {
  readonly ok: false;
  readonly failure: ReturnType<typeof notFound<LetterIssued>>;
}

/** The request and the template version it named — the version it named, never the current one. */
const resolveRequest = async (
  dependencies: LettersDependencies,
  transaction: Transaction,
  letterRequestId: string,
): Promise<Resolved | Unresolved> => {
  const request = await dependencies.stores.requests.byId(transaction, letterRequestId);

  if (request === undefined) {
    return { ok: false, failure: notFound<LetterIssued>('letter_request') };
  }

  const version = await dependencies.stores.templateVersions.byId(
    transaction,
    request.letterTemplateVersionId,
  );

  if (version === undefined) {
    return { ok: false, failure: notFound<LetterIssued>('letter_template_version') };
  }
  return { ok: true, request, version };
};

/** AD-005's caller-side gate. A template exposing no money needs nothing extra. */
const salaryPermitted = async (
  dependencies: LettersDependencies,
  version: LetterTemplateVersionState,
): Promise<boolean> => {
  const exposesMoney =
    version.exposedFields.includes('salary') || version.exposedFields.includes('payroll');

  if (!exposesMoney) return true;
  return dependencies.permissions.holds(LettersPermissions.includeSalary);
};

/**
 * Resolve, substitute, allocate a number, freeze.
 *
 * The request moves through `generating` before it reaches `generated`, so a failure has somewhere
 * to be recorded rather than leaving the request looking untouched. Nothing runs asynchronously:
 * there is no `JobPort` adapter and no renderer, so generation completes or fails inside the request
 * that asked for it.
 */
const issueFrom = async (
  dependencies: LettersDependencies,
  transaction: Transaction,
  request: LetterRequestState,
  version: LetterTemplateVersionState,
  command: IssueLetterCommand,
): Promise<
  ReturnType<typeof success<LetterIssued>> | ReturnType<typeof notFound<LetterIssued>>
> => {
  const generating = moveRequestTo(request, 'generating');

  if (!generating.ok) return refusedBy<LetterIssued>(generating.error);

  const resolution = await resolveVariables(version, dependencies.sources, {
    employmentId: request.employmentId,
    personId: request.personId,
  });

  if (!resolution.ok) return refusedBy<LetterIssued>(resolution.error);

  const content = generate({
    templateVersion: version,
    locale: request.locale,
    resolved: resolution.value.resolved,
  });

  if (!content.ok) return refusedBy<LetterIssued>(content.error);

  const generated = moveRequestTo(generating.value, 'generated');

  if (!generated.ok) return refusedBy<LetterIssued>(generated.error);

  const issued = issueLetter({
    issuedLetterId: uuidV7(),
    request: generated.value,
    templateVersion: version,
    content: content.value,
    sourceVersions: resolution.value.sourceVersions,
    referenceNumber: await referenceNumber(dependencies, transaction),
    verificationToken: dependencies.tokens.issue(),
    issuedAt: dependencies.clock.now(),
    issuedBy: currentActor(),
    ...(command.signatory === undefined ? {} : { signatory: command.signatory }),
  });

  if (!issued.ok) return refusedBy<LetterIssued>(issued.error);

  const finished = moveRequestTo(generated.value, 'issued');

  if (!finished.ok) return refusedBy<LetterIssued>(finished.error);

  await persist(dependencies, transaction, {
    request,
    finished: finished.value,
    version,
    issued: issued.value,
    ...(command.supersedesId === undefined ? {} : { supersedesId: command.supersedesId }),
  });

  return success({
    issuedLetterId: issued.value.issuedLetterId,
    letterRequestId: request.letterRequestId,
    referenceNumber: issued.value.referenceNumber,
    body: content.value.body,
  });
};

/** `LTR-000001`. Sequential and printed on the letter, which is why it is not the token (D-20). */
const referenceNumber = async (
  dependencies: LettersDependencies,
  transaction: Transaction,
): Promise<string> => {
  const allocated = await dependencies.stores.numbers.allocate(transaction, SERIES_KEY);

  return `LTR-${String(allocated).padStart(6, '0')}`;
};

interface Persistable {
  readonly request: LetterRequestState;
  readonly finished: LetterRequestState;
  readonly version: LetterTemplateVersionState;
  readonly issued: IssuedLetterState;
  readonly supersedesId?: string;
}

/** One transaction: the request, the letter, the template's freeze stamp and any supersession. */
const persist = async (
  dependencies: LettersDependencies,
  transaction: Transaction,
  what: Persistable,
): Promise<void> => {
  await dependencies.stores.requests.update(transaction, what.finished, what.request.version);
  await dependencies.stores.issued.insert(transaction, what.issued);

  if (what.version.firstIssuedAt === undefined) {
    // The moment this version stopped being editable. Recorded once and never cleared.
    await dependencies.stores.templateVersions.markFirstIssued(
      transaction,
      what.version.letterTemplateVersionId,
      what.issued.issuedAt,
    );
  }
  if (what.supersedesId !== undefined) {
    await dependencies.stores.issued.supersede(
      transaction,
      what.supersedesId,
      what.issued.issuedLetterId,
      what.issued.issuedAt,
    );
  }
};
