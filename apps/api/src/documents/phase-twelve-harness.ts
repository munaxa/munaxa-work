import 'reflect-metadata';

import {
  Dispatcher,
  GrantAwarePermissionChecker,
  runInContext,
  success,
  uuidV7,
  type Command,
  type HandlerFailure,
  type PermissionChecker,
  type Query,
  type QueryHandler,
  type Result,
  type UnitOfWork,
} from '@work/kernel';
import {
  ALL_DOCUMENTS_PERMISSIONS,
  documentsModule,
  inMemoryDocumentsStores,
  storageUnavailable,
} from '@work/documents';
import {
  ALL_LETTERS_PERMISSIONS,
  inMemoryLettersStores,
  lettersModule,
  type LetterSources,
} from '@work/letters';
import { InMemoryUnitOfWork } from '@work/testing';

import { DocumentsOwnerDirectory, DocumentsPersonIdentifiers } from './documents-sources.js';
import {
  LetterEmploymentSource,
  LetterOrganizationSource,
  LetterPersonSource,
  LetterSalarySource,
} from '../letters/letters-sources.js';
import type { Asking } from '../payroll/asking.js';

/**
 * The wiring the Phase 12 cross-module suite runs against: Documents and Letters on **one real
 * dispatcher**, connected to the rest of the product by the real adapters the composition root
 * builds.
 *
 * `DocumentsOwnerDirectory`, `DocumentsPersonIdentifiers`, `LetterPersonSource`,
 * `LetterEmploymentSource`, `LetterOrganizationSource` and `LetterSalarySource` are the
 * **production classes**, and every cross-module call goes through the real bounded service grant.
 *
 * People, Employment, Organization and Compensation are represented by **stub query handlers on the
 * same dispatcher** rather than by fake ports. The distinction is the point: the adapter under test
 * still sends `people.read-profile`, `employment.read-employment`,
 * `organization.governing-legal-entity` and `compensation.payroll-period` through the dispatcher,
 * still runs inside its grant, and still maps the published view — so a change to any of those
 * contracts' *shapes* breaks this suite, which is what testing an adapter rather than a mock of one
 * is for.
 *
 * **Nothing publishes an event and nothing subscribes to one.** That is not a simplification: both
 * modules pull every cross-module fact at the moment they need it, so there is no delivery to lose.
 * The suite asserts it.
 */

export const TENANT = uuidV7();
export const NOW = new Date('2026-08-11T09:00:00Z');

export const ADMINISTRATOR = 'user:hr-administrator';
export const VERIFIER = 'user:hr-verifier';
export const APPROVER = 'user:hr-approver';

export const PERSON_ID = '01900000-0000-7000-8000-00000000a001';
export const EMPLOYMENT_ID = '01900000-0000-7000-8000-00000000a002';
export const UNIT_ID = '01900000-0000-7000-8000-00000000a003';
export const LEGAL_ENTITY_ID = '01900000-0000-7000-8000-00000000a004';
export const IDENTIFIER_ID = '01900000-0000-7000-8000-00000000a005';

/**
 * The caller's own permissions, wrapped exactly as the composition root wraps them.
 *
 * `GrantAwarePermissionChecker` is what makes a bounded service grant mean anything: it consults
 * the platform first and adds only the narrow, named authority a module holds while acting inside
 * another, and adds nothing at all when no grant is open. Without the wrapper an adapter's grant
 * would be inert and every cross-module read would be refused — which is what a plain checker here
 * proved the first time this suite ran.
 */
const permitting = (granted: readonly string[]): PermissionChecker =>
  new GrantAwarePermissionChecker({
    holds: (permission) => Promise.resolve(granted.includes(permission)),
  });

/**
 * The four upstream modules, as the facts they publish.
 *
 * Mutable on purpose: a suite changes a salary or an identifier's expiry *here* and asks the
 * modules under test what they now say. That is how the D-1a boundary and the frozen letter
 * snapshot are both proved — one must move with the source, the other must not.
 */
export interface UpstreamFacts {
  personVersion: number;
  legalNameEn: string;
  identifierExpiresOn: string | undefined;
  identifierPresent: boolean;
  employmentPresent: boolean;
  salaryMinor: string;
}

export const upstream = (): UpstreamFacts => ({
  personVersion: 1,
  legalNameEn: 'Layla Haddad',
  identifierExpiresOn: '2029-05-04',
  identifierPresent: true,
  employmentPresent: true,
  salaryMinor: '1200000',
});

export interface Harness {
  readonly dispatcher: Dispatcher;
  readonly facts: UpstreamFacts;
  as<TResult>(actor: string, work: () => Promise<TResult>): Promise<TResult>;
}

export interface HarnessOptions {
  readonly permissions?: readonly string[];
}

const ALL: readonly string[] = [...ALL_DOCUMENTS_PERMISSIONS, ...ALL_LETTERS_PERMISSIONS];

export const harnessFor = (options: HarnessOptions = {}): Harness => {
  const permissions = permitting(options.permissions ?? ALL);
  const dispatcher = new Dispatcher(permissions);
  const facts = upstream();
  const unitOfWork: UnitOfWork = new InMemoryUnitOfWork(TENANT);
  const asking: Asking = { ask: (query) => dispatcher.ask(query) };

  for (const handler of upstreamHandlers(facts)) dispatcher.registerQuery(handler);

  const clock = { now: () => NOW };

  register(
    dispatcher,
    documentsModule({
      unitOfWork,
      stores: inMemoryDocumentsStores(),
      owners: new DocumentsOwnerDirectory(asking),
      identifiers: new DocumentsPersonIdentifiers(asking),
      storage: storageUnavailable,
      permissions,
      clock,
    }),
  );
  register(
    dispatcher,
    lettersModule({
      unitOfWork,
      stores: inMemoryLettersStores(),
      sources: letterSources(asking),
      tokens: { issue: () => uuidV7().replace(/-/g, '').padEnd(64, '0') },
      permissions,
      clock,
    }),
  );

  return {
    dispatcher,
    facts,
    as: (actor, work) => runInContext({ tenantId: TENANT, correlationId: uuidV7(), actor }, work),
  };
};

const letterSources = (asking: Asking): LetterSources => ({
  person: new LetterPersonSource(asking),
  employment: new LetterEmploymentSource(asking),
  organization: new LetterOrganizationSource(asking),
  salary: new LetterSalarySource(asking, () => '2026-08-11'),
});

const register = (
  dispatcher: Dispatcher,
  module: { commands?: readonly unknown[]; queries?: readonly unknown[] },
): void => {
  for (const handler of module.commands ?? []) {
    dispatcher.registerCommand(handler as Parameters<typeof dispatcher.registerCommand>[0]);
  }
  for (const handler of module.queries ?? []) {
    dispatcher.registerQuery(handler as Parameters<typeof dispatcher.registerQuery>[0]);
  }
};

/**
 * The four upstream contracts, answered as the real modules answer them.
 *
 * Each declares the permission the real handler declares, so the bounded service grant is genuinely
 * exercised: an adapter whose grant named the wrong permission would be refused here exactly as it
 * would be in production.
 */
const upstreamHandlers = (facts: UpstreamFacts): readonly QueryHandler<Query, unknown>[] =>
  [
    readPerson(facts),
    readProfile(facts),
    readEmployment(facts),
    governingLegalEntity(),
    compensationPeriod(facts),
  ] as readonly QueryHandler<Query, unknown>[];

interface WithPersonId extends Query {
  readonly personId: string;
}

const readPerson = (facts: UpstreamFacts): QueryHandler<WithPersonId, unknown> => ({
  queryName: 'people.read-person',
  permission: 'people.person.read',

  handle: (query) =>
    Promise.resolve(
      query.personId === PERSON_ID
        ? success({
            personId: PERSON_ID,
            personNumber: 'P-000001',
            legalName: { en: facts.legalNameEn, ar: 'ليلى حداد' },
            status: 'active',
            asOf: '2026-08-11',
            metadata: {},
            version: facts.personVersion,
          })
        : notFound('person'),
    ),
});

const readProfile = (facts: UpstreamFacts): QueryHandler<WithPersonId, unknown> => ({
  queryName: 'people.read-profile',
  permission: 'people.person.read',

  handle: (query) => {
    if (query.personId !== PERSON_ID) return Promise.resolve(notFound('person'));

    return Promise.resolve(
      success({
        person: {
          personId: PERSON_ID,
          personNumber: 'P-000001',
          legalName: { en: facts.legalNameEn, ar: 'ليلى حداد' },
          status: 'active',
          asOf: '2026-08-11',
          metadata: {},
          version: facts.personVersion,
        },
        names: [],
        // Absent rather than empty when withheld, exactly as People does — and the value is never
        // present, because Documents' grant does not include `people.identifier.read-value`.
        ...(facts.identifierPresent
          ? {
              identifiers: [
                {
                  identifierId: IDENTIFIER_ID,
                  identifierType: 'passport',
                  maskedValue: '••••4321',
                  issuingCountry: 'JO',
                  issuedOn: '2019-05-04',
                  ...(facts.identifierExpiresOn === undefined
                    ? {}
                    : { expiresOn: facts.identifierExpiresOn }),
                  isPrimary: true,
                  withdrawn: false,
                  version: 1,
                },
              ],
            }
          : {}),
        withheld: [],
      }),
    );
  },
});

interface WithEmploymentId extends Query {
  readonly employmentId: string;
}

const readEmployment = (facts: UpstreamFacts): QueryHandler<WithEmploymentId, unknown> => ({
  queryName: 'employment.read-employment',
  permission: 'employment.employment.read',

  handle: (query) =>
    Promise.resolve(
      query.employmentId === EMPLOYMENT_ID && facts.employmentPresent
        ? success({
            employmentId: EMPLOYMENT_ID,
            employmentNumber: 'E-000001',
            personId: PERSON_ID,
            status: 'active',
            employmentTypeCode: 'permanent',
            originalHireDate: '2024-03-01',
            startDate: '2024-03-01',
            asOf: '2026-08-11',
            assignment: {
              assignmentId: uuidV7(),
              employmentId: EMPLOYMENT_ID,
              unitId: UNIT_ID,
              assignmentType: 'primary',
              fte: 1,
              effectiveFrom: new Date('2024-03-01T00:00:00Z'),
              version: 1,
            },
            metadata: {},
            version: 3,
          })
        : notFound('employment'),
    ),
});

const governingLegalEntity = (): QueryHandler<Query & { unitId: string }, unknown> => ({
  queryName: 'organization.governing-legal-entity',
  permission: 'organization.legal-entity.read',

  handle: (query) =>
    Promise.resolve(
      success({
        unitId: query.unitId,
        asOf: NOW,
        legalEntity:
          query.unitId === UNIT_ID
            ? {
                id: LEGAL_ENTITY_ID,
                unitId: UNIT_ID,
                countryCode: 'JO',
                registeredName: { en: 'Munaxa LLC', ar: 'مناكسا ذ.م.م' },
                registrationNumber: 'JO-123456',
                currencyCode: 'JOD',
                version: 2,
              }
            : undefined,
        throughUnitIds: [],
      }),
    ),
});

const compensationPeriod = (
  facts: UpstreamFacts,
): QueryHandler<Query & { employmentIds: readonly string[] }, unknown> => ({
  queryName: 'compensation.payroll-period',
  permission: 'compensation.read',

  handle: (query) =>
    Promise.resolve(
      success(
        query.employmentIds
          .filter((id) => id === EMPLOYMENT_ID)
          .map((employmentId) => ({
            employmentId,
            periodStart: '2026-08-11',
            periodEnd: '2026-08-11',
            currencies: [
              {
                currencyCode: 'JOD',
                currencyExponent: 3,
                recurring: [
                  {
                    componentId: uuidV7(),
                    componentCode: 'base',
                    kind: 'recurring',
                    payrollTreatmentCode: 'basic',
                    proratable: true,
                    amount: { amount: facts.salaryMinor, currencyCode: 'JOD', exponent: 3 },
                    effectiveFrom: '2024-03-01',
                    partial: false,
                  },
                ],
                oneTime: [],
              },
            ],
            inputsDigest: 'digest',
            calculationVersion: 1,
          })),
      ),
    ),
});

const notFound = (resource: string): Result<never, HandlerFailure> => ({
  ok: false,
  error: { kind: 'not_found', resource },
});

/** Sends a command and fails loudly, so a broken step names itself rather than the next one. */
export const send = async <TResult>(
  harness: Harness,
  command: Record<string, unknown>,
): Promise<TResult> => {
  const result = await harness.dispatcher.send<TResult>(command as unknown as Command);

  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.value;
};

export const attempt = (
  harness: Harness,
  command: Record<string, unknown>,
): Promise<Result<unknown, HandlerFailure>> =>
  harness.dispatcher.send(command as unknown as Command);

export const ask = async <TResult>(
  harness: Harness,
  query: Record<string, unknown>,
): Promise<TResult> => {
  const result = await harness.dispatcher.ask<TResult>(query as unknown as Query);

  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.value;
};
