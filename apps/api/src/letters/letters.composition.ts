import {
  lettersModule,
  postgresLettersStores,
  randomVerificationToken,
  type LetterSources,
} from '@work/letters';
import { systemClock } from '@work/payroll';
import type { PermissionChecker, UnitOfWork, WorkModule } from '@work/kernel';

import type { DeferredPayrollDispatcher } from '../payroll/payroll.composition.js';
import {
  LetterEmploymentSource,
  LetterOrganizationSource,
  LetterPersonSource,
  LetterSalarySource,
} from './letters-sources.js';

/**
 * Letters' composition: four source adapters, the PostgreSQL stores, and a real random token.
 *
 * **`payroll` is deliberately absent from `sources`.** It is in the vocabulary a template may
 * declare, and no adapter is wired for it — so a template that declares `payroll` is refused with
 * `source_not_configured` rather than resolving to something adjacent. Payroll's result reads are
 * scoped to a *run* rather than to an employment, and a letter variable resolved from one would
 * name a payroll run a template author has no way to choose. Recorded as `NOT VERIFIED`, not
 * approximated.
 *
 * `randomVerificationToken` is the only implementation of its port and reaches the operating
 * system's cryptographic source. The alternative is not a lesser token, it is a public register of
 * who works where: the verification endpoint takes the token and nothing else.
 */
export const lettersModuleFor = (
  unitOfWork: UnitOfWork,
  dispatcher: DeferredPayrollDispatcher,
  permissions: PermissionChecker,
): WorkModule =>
  lettersModule({
    unitOfWork,
    stores: postgresLettersStores(),
    sources: sourcesFor(dispatcher),
    tokens: randomVerificationToken,
    permissions,
    clock: systemClock,
  });

const sourcesFor = (dispatcher: DeferredPayrollDispatcher): LetterSources => ({
  person: new LetterPersonSource(dispatcher),
  employment: new LetterEmploymentSource(dispatcher),
  organization: new LetterOrganizationSource(dispatcher),
  salary: new LetterSalarySource(dispatcher, () => systemClock.now().toISOString().slice(0, 10)),
});
