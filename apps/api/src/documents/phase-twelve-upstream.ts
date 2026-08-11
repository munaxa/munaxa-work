import { success, type HandlerFailure, type Query, type QueryHandler, type Result } from '@work/kernel';
import { uuidV7 } from '@work/kernel';

/**
 * The four upstream contracts, answered as the real modules answer them.
 *
 * Stub *query handlers on the same dispatcher* rather than fake ports. The distinction is the
 * point: the adapter under test still sends `people.read-profile`, `employment.read-employment`,
 * `organization.governing-legal-entity` and `compensation.payroll-period` through the dispatcher,
 * still runs inside its bounded service grant, and still maps the published view — so a change to
 * any of those contracts' shapes breaks the suite, which is what testing an adapter rather than a
 * mock of one is for.
 *
 * Each handler declares the permission the real handler declares, so an adapter whose grant named
 * the wrong permission is refused here exactly as it would be in production.
 */

export const NOW = new Date('2026-08-11T09:00:00Z');

export const PERSON_ID = '01900000-0000-7000-8000-00000000a001';
export const EMPLOYMENT_ID = '01900000-0000-7000-8000-00000000a002';
export const UNIT_ID = '01900000-0000-7000-8000-00000000a003';
export const LEGAL_ENTITY_ID = '01900000-0000-7000-8000-00000000a004';
export const IDENTIFIER_ID = '01900000-0000-7000-8000-00000000a005';

/** What the upstream modules currently say. Changed by a suite between reads. */
export interface UpstreamFacts {
  personVersion: number;
  legalNameEn: string;
  identifierExpiresOn: string | undefined;
  identifierPresent: boolean;
  employmentPresent: boolean;
  salaryMinor: string;
}

export const upstreamHandlers = (facts: UpstreamFacts): readonly QueryHandler<Query, unknown>[] =>
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

