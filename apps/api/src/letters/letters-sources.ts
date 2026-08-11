import { runWithServiceGrant, type HandlerFailure, type Query, type Result } from '@work/kernel';
import type { LetterSourcePort, LetterSubject, SourceFacts } from '@work/letters';
import type { PersonView } from '@work/people';
import type { EmploymentView } from '@work/employment';
import type { CompensationCurrencyBlockView, CompensationPeriodView } from '@work/compensation';
import type { GoverningLegalEntity, LegalEntityView } from '@work/organization';

import type { Asking } from '../payroll/asking.js';

/**
 * What a letter is allowed to say, and where each fact comes from.
 *
 * Four adapters, one per exposable field a template may declare. Every one reaches the owning
 * module through its **published queries**, never its repositories, and every call runs inside a
 * **bounded service grant** (ADR-0043): requesting a letter must not make somebody a reader of the
 * person register, the employment register or the compensation record.
 *
 * **Nothing here writes.** There is no method on any adapter that could change a fact in another
 * module. The dependency points one way and Letters pulls (ADR-0058, ADR-0064).
 *
 * Two things are deliberate and load-bearing.
 *
 * **`undefined` means "could not be asked", never "no facts".** A source that failed silently would
 * produce a bank letter stating an employee earns nothing, over the employer's name. Every adapter
 * here returns `undefined` on a failed read and the domain refuses the letter.
 *
 * **A `sourceVersion` travels with every answer**, and is frozen beside the values on issue. It is
 * what lets somebody say which revision of the employment record a March certificate was generated
 * from, without re-reading a record that has since changed.
 *
 * There is no `payroll` adapter. Payroll's result reads are behind `payroll.read-result` and are
 * scoped to a run rather than to an employment, so a letter variable resolved from one would name a
 * payroll run a template author has no way to choose. `payroll` stays in the vocabulary and is
 * **NOT VERIFIED** as a letter source: a template declaring it is refused with
 * `source_not_configured` rather than silently resolving to something adjacent.
 */

const PERSON_READ = 'people.person.read';
const EMPLOYMENT_READ = 'employment.employment.read';
const LEGAL_ENTITY_READ = 'organization.legal-entity.read';
const COMPENSATION_READ = 'compensation.read';

const asking = <TResult, TQuery extends Query>(
  dispatcher: Asking,
  query: TQuery,
): Promise<Result<TResult, HandlerFailure>> => dispatcher.ask<TResult>(query);

interface ReadPersonQuery extends Query {
  readonly queryName: 'people.read-person';
  readonly personId: string;
}

interface ReadEmploymentQuery extends Query {
  readonly queryName: 'employment.read-employment';
  readonly employmentId: string;
}

interface GoverningLegalEntityQuery extends Query {
  readonly queryName: 'organization.governing-legal-entity';
  readonly unitId: string;
}

interface CompensationPeriodQuery extends Query {
  readonly queryName: 'compensation.payroll-period';
  readonly employmentIds: readonly string[];
  readonly periodStart: string;
  readonly periodEnd: string;
}

/** `person.fullName`, and the person's number. Nothing sensitive: no birth date, no identifier. */
export class LetterPersonSource implements LetterSourcePort {
  public constructor(private readonly dispatcher: Asking) {}

  public async factsFor(subject: LetterSubject): Promise<SourceFacts | undefined> {
    const person = await runWithServiceGrant(
      {
        module: 'letters',
        operation: 'letters.issue',
        permits: [PERSON_READ],
        reason: 'Resolving the person variables a letter template declared',
      },
      () =>
        asking<PersonView, ReadPersonQuery>(this.dispatcher, {
          queryName: 'people.read-person',
          personId: subject.personId,
        }),
    );

    if (!person.ok) return undefined;
    return {
      values: {
        fullName: person.value.legalName.en,
        fullNameAr: person.value.legalName.ar,
        personNumber: person.value.personNumber,
      },
      sourceVersion: String(person.value.version),
    };
  }
}

/** `employment.startDate`, `employment.employmentNumber`, `employment.status`. */
export class LetterEmploymentSource implements LetterSourcePort {
  public constructor(private readonly dispatcher: Asking) {}

  public async factsFor(subject: LetterSubject): Promise<SourceFacts | undefined> {
    const employment = await runWithServiceGrant(
      {
        module: 'letters',
        operation: 'letters.issue',
        permits: [EMPLOYMENT_READ],
        reason: 'Resolving the employment variables a letter template declared',
      },
      () =>
        asking<EmploymentView, ReadEmploymentQuery>(this.dispatcher, {
          queryName: 'employment.read-employment',
          employmentId: subject.employmentId,
        }),
    );

    if (!employment.ok) return undefined;
    return {
      values: {
        employmentNumber: employment.value.employmentNumber,
        startDate: employment.value.startDate,
        status: employment.value.status,
      },
      sourceVersion: String(employment.value.version),
    };
  }
}

/**
 * `organization.legalName` and `organization.registrationNumber` — the employer, as it is registered.
 *
 * Resolved the way 00B requires and Phase 11.1 already depends on: an employment does not carry a
 * legal entity, it carries an **assignment to a unit**, and the governing entity is found by walking
 * up from that unit. A team inside a department inside a branch of a Jordanian company resolves to
 * the Jordanian company; its sibling under the Saudi company resolves to the Saudi one, in the same
 * tenant, on the same request.
 *
 * Every step that cannot answer refuses. There is **no tenant-level fallback** — that is exactly the
 * mistake 00B names, and here it would print the wrong employer's name on a letter a bank acts on.
 */
export class LetterOrganizationSource implements LetterSourcePort {
  public constructor(private readonly dispatcher: Asking) {}

  public async factsFor(subject: LetterSubject): Promise<SourceFacts | undefined> {
    const resolved = await runWithServiceGrant(
      {
        module: 'letters',
        operation: 'letters.issue',
        permits: [EMPLOYMENT_READ, LEGAL_ENTITY_READ],
        reason:
          'Resolving the employer a letter names, through the unit the employment is assigned to',
      },
      () => this.employerOf(subject.employmentId),
    );

    if (resolved === undefined) return undefined;
    return {
      values: {
        legalName: resolved.registeredName['en'] ?? '',
        legalNameAr: resolved.registeredName['ar'] ?? '',
        registrationNumber: resolved.registrationNumber,
        countryCode: resolved.countryCode,
      },
      sourceVersion: String(resolved.version),
    };
  }

  private async employerOf(employmentId: string): Promise<LegalEntityView | undefined> {
    const employment = await asking<EmploymentView, ReadEmploymentQuery>(this.dispatcher, {
      queryName: 'employment.read-employment',
      employmentId,
    });

    if (!employment.ok) return undefined;

    const unitId = employment.value.assignment?.unitId;

    // An employment with no placement on this date has no employer to name.
    if (unitId === undefined) return undefined;

    const governing = await asking<GoverningLegalEntity, GoverningLegalEntityQuery>(
      this.dispatcher,
      { queryName: 'organization.governing-legal-entity', unitId },
    );

    return governing.ok ? governing.value.legalEntity : undefined;
  }
}

/**
 * `salary.monthly` — and the reason `letter.include-salary` exists.
 *
 * Compensation's period read is the same contract Payroll uses, asked for a single day so it
 * answers with what is in force now rather than a period total. The grant is `compensation.read`
 * and nothing wider.
 *
 * A caller reaching this adapter has already passed **both** of AD-005's gates: the template
 * declared `salary` in its exposed fields, and the issuer holds `letter.include-salary`. Without
 * the second, a letter would be a way to read a salary the caller could not read directly.
 */
export class LetterSalarySource implements LetterSourcePort {
  public constructor(
    private readonly dispatcher: Asking,
    private readonly today: () => string,
  ) {}

  public async factsFor(subject: LetterSubject): Promise<SourceFacts | undefined> {
    const on = this.today();
    const periods = await runWithServiceGrant(
      {
        module: 'letters',
        operation: 'letters.issue',
        permits: [COMPENSATION_READ],
        reason: 'Resolving the pay figure a salary certificate states',
      },
      () =>
        asking<readonly CompensationPeriodView[], CompensationPeriodQuery>(this.dispatcher, {
          queryName: 'compensation.payroll-period',
          employmentIds: [subject.employmentId],
          periodStart: on,
          periodEnd: on,
        }),
    );

    if (!periods.ok) return undefined;

    const held = periods.value.find((one) => one.employmentId === subject.employmentId);

    // No compensation on record is not an outage, but it is still not a figure to print.
    if (held === undefined) return undefined;

    const block = held.currencies[0];

    // Compensation answers one block per currency and never sums across them. A letter states one
    // figure, so an employment paid in two currencies is refused rather than silently halved.
    if (block === undefined || held.currencies.length > 1) return undefined;
    return {
      values: {
        monthly: `${totalOf(block)} ${block.currencyCode}`,
        currency: block.currencyCode,
      },
      // The day the figure was read on. What makes "this certificate states March's salary"
      // answerable after April's raise.
      sourceVersion: on,
    };
  }
}

/**
 * The recurring total for one currency block, as an exact decimal string.
 *
 * Summed as `bigint` minor units and formatted with the block's own exponent — never through a
 * double. A salary certificate is a document a bank acts on, and a rounding error here is one a
 * customer discovers at a mortgage desk.
 *
 * One-time components are deliberately excluded: a bonus paid once is not what "monthly salary"
 * means on a certificate.
 */
const totalOf = (block: CompensationCurrencyBlockView): string => {
  const minor = block.recurring.reduce(
    (sum, component) => sum + BigInt(component.amount.amount),
    0n,
  );
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(block.currencyExponent + 1, '0');
  const whole = digits.slice(0, digits.length - block.currencyExponent);
  const fraction = digits.slice(digits.length - block.currencyExponent);

  return `${negative ? '-' : ''}${whole}${fraction === '' ? '' : `.${fraction}`}`;
};
