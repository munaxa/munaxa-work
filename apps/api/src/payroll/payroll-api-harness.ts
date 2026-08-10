import type { Server } from 'node:http';

import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loadEnvironment } from '@work/config';
import { Dispatcher, runInContext, uuidV7, type PermissionChecker } from '@work/kernel';
import {
  PayrollConfigurationController,
  PayrollDecisionController,
  PayrollDispatcher,
  PayrollPermissions,
  PayrollResultController,
  PayrollRunController,
  attendanceUnavailable,
  inMemoryPayrollStores,
  leaveUnavailable,
  noCountryRules,
  payrollModule,
  sourceAnswered,
  type CompensationFacts,
  type EmploymentFacts,
} from '@work/payroll';
import { InMemoryUnitOfWork } from '@work/testing';

import { configureApplication } from '../application.setup.js';
import { AuthenticatedTenantGuard } from '../tenancy/authenticated-tenant.guard.js';

/**
 * The composition the Payroll API specs share: the real controllers, the real dispatcher, the real
 * global filter and validation pipe, over in-memory stores.
 *
 * Shared rather than repeated because a spec that assembles the application slightly differently
 * from production proves nothing about production — and four specs each assembling it their own way
 * is four chances to drift. Tenant isolation is deliberately **not** tested here: these tables are
 * not tenant-scoped, because in production RLS is what scopes them. That proof belongs against real
 * PostgreSQL, and lives in `payroll.postgres-api.spec.ts`.
 */

export const TENANT = uuidV7();
export const NOW = new Date('2026-07-01T09:00:00Z');
export const EMPLOYMENT = uuidV7();

/** A second named human, so a run is never approved by whoever requested it. */
export const APPROVER = 'user:payroll-approver';
export const REQUESTER = 'user:payroll-administrator';

/** A salary of 9,007,199,254,740,993 fils — one past what a double can hold. */
export const ENORMOUS = '9007199254740993';

export const ALL: readonly string[] = Object.values(PayrollPermissions);

export const permitting = (...granted: readonly string[]): PermissionChecker => ({
  holds: (permission) => Promise.resolve(granted.includes(permission)),
});

const environment = loadEnvironment({
  APP_NAME: 'munaxa-work-test',
  APP_VERSION: '0.0.0-test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/work',
});

const employmentFacts: EmploymentFacts = {
  employmentId: EMPLOYMENT,
  status: 'active',
  startDate: '2020-01-01',
  employmentTypeCode: 'full-time',
  version: 1,
};

const compensationFacts: CompensationFacts = {
  currencies: [
    {
      currencyCode: 'JOD',
      currencyExponent: 3,
      recurring: [
        {
          componentId: uuidV7(),
          componentCode: 'salary',
          kind: 'base',
          payrollTreatmentCode: 'ordinary',
          proratable: true,
          amount: { amountMinor: BigInt(ENORMOUS), currencyCode: 'JOD', currencyExponent: 3 },
          effectiveFrom: '2020-01-01',
          partialPeriod: false,
        },
      ],
      oneTime: [],
    },
  ],
  inputsDigest: 'aaaa0001',
  calculationVersion: 1,
};

export interface HarnessOptions {
  /** Omitted means every request arrives with no authenticated context at all. */
  readonly actor?: string | undefined;
}

const modulesFor = (checker: PermissionChecker): Dispatcher => {
  const dispatcher = new Dispatcher(checker);
  const module = payrollModule({
    unitOfWork: new InMemoryUnitOfWork(TENANT),
    stores: inMemoryPayrollStores(),
    employment: {
      // Cursor-paged, like the production adapter. A fake that ignored `after` would hand the
      // driver the same identifier forever — which is exactly what it did, until the driver
      // learned to refuse a source that does not advance.
      employmentIds: (_legalEntityId, after) =>
        Promise.resolve(after === undefined ? [EMPLOYMENT] : []),
      factsFor: () => Promise.resolve(sourceAnswered(new Map([[EMPLOYMENT, employmentFacts]]))),
    },
    compensation: {
      factsFor: () => Promise.resolve(sourceAnswered(new Map([[EMPLOYMENT, compensationFacts]]))),
      changedSince: () => Promise.resolve([]),
    },
    // Honest adapters for a composition without those contracts: they answer "unknown".
    attendance: attendanceUnavailable,
    leave: leaveUnavailable,
    organization: {
      legalEntity: (legalEntityId) =>
        Promise.resolve({
          known: true,
          entity: { legalEntityId, countryCode: 'JO', currencyCode: 'JOD' },
        }),
    },
    countryRules: noCountryRules,
    clock: { now: () => NOW },
  });

  for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
  for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);
  return dispatcher;
};

export const applicationWith = async (
  checker: PermissionChecker,
  options: HarnessOptions = { actor: REQUESTER },
): Promise<INestApplication> => {
  const testing = await Test.createTestingModule({
    // The same order the Nest module declares, because that order is what makes
    // `POST /payroll/runs/calculation` resolve to calculation rather than to a run read.
    controllers: [
      PayrollConfigurationController,
      PayrollResultController,
      PayrollDecisionController,
      PayrollRunController,
    ],
    providers: [
      { provide: PayrollDispatcher, useValue: new PayrollDispatcher(modulesFor(checker)) },
      { provide: APP_GUARD, useClass: AuthenticatedTenantGuard },
    ],
  }).compile();

  const application = testing.createNestApplication();

  // Stands in for the authenticated identity Platform will supply. `x-test-actor` lets one
  // scenario act as two people, which is the only way to approve a run somebody else requested —
  // the database refuses `decided_by = requested_by` and the domain refuses it before that.
  // With no actor configured nothing is established, which is what an unauthenticated caller sees.
  application.use(
    (
      incoming: { readonly headers: Record<string, string | undefined> },
      _response: unknown,
      next: () => void,
    ) => {
      const acting = incoming.headers['x-test-actor'] ?? options.actor;

      if (acting === undefined) {
        next();
        return;
      }
      runInContext({ tenantId: TENANT, correlationId: uuidV7(), actor: acting }, next);
    },
  );
  configureApplication(application, environment);
  await application.init();
  return application;
};

/**
 * The published shapes these specs read, and the one cast that produces them.
 *
 * `supertest` types a response body as `any`, and reaching into it directly would put an implicit
 * `any` on every assertion in the suite. One narrow cast per read keeps the assertions typed —
 * which matters most for the money fields, where the whole point is that `amountMinor` is a
 * **string** and a test that silently accepted a number would prove nothing.
 */
export interface MoneyBody {
  readonly amountMinor: string;
  readonly currencyCode: string;
  readonly currencyExponent: number;
}

export interface PageBody<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

export interface ResultItem {
  readonly payrollResultId: string;
  readonly employmentId: string;
  readonly gross: MoneyBody;
  readonly net: MoneyBody;
}

export interface RunBody {
  readonly payrollRunId: string;
  readonly payrollPeriodId: string;
  readonly status: string;
  readonly resultCount: number;
}

export interface PeriodItem {
  readonly payrollPeriodId: string;
}

export interface GroupBody {
  readonly payrollGroupId: string;
}

export interface AccountingItem {
  readonly direction: string;
  readonly amount: MoneyBody;
}

export interface PaymentItem {
  readonly status: string;
}

export const bodyOf = <TBody>(response: { readonly body: unknown }): TBody =>
  response.body as TBody;

export interface Configured {
  readonly payrollGroupId: string;
  readonly payrollPeriodId: string;
}

export const defineGroup = (http: Server, code = 'monthly-staff'): request.Test =>
  request(http)
    .post('/api/v1/payroll/groups')
    .send({
      legalEntityId: uuidV7(),
      code,
      name: { en: 'Monthly staff', ar: 'الموظفون الشهريون' },
      payFrequency: 'monthly',
      permittedCurrencies: [{ code: 'JOD', exponent: 3 }],
      prorationBasis: 'calendar_days',
      roundingMode: 'half-up',
      paysSuspended: false,
      expenseAccount: 'payroll-expense',
      deductionAccount: 'payroll-deductions',
      payableAccount: 'payroll-payable',
      paymentMethodCode: 'bank-transfer',
    });

/** Opens one period. `month` is 1-12; each call takes a distinct, non-overlapping range. */
export const openPeriod = async (
  http: Server,
  payrollGroupId: string,
  month = 6,
): Promise<string> => {
  const mm = String(month).padStart(2, '0');
  const last = new Date(Date.UTC(2026, month, 0)).getUTCDate();
  const period = await request(http)
    .post('/api/v1/payroll/periods')
    .send({
      payrollGroupId,
      code: `2026-${mm}`,
      periodStart: `2026-${mm}-01`,
      periodEnd: `2026-${mm}-${last}`,
      paymentDate: `2026-${mm}-${last}`,
    })
    .expect(201);
  const { payrollPeriodId } = bodyOf<PeriodItem>(period);

  await request(http)
    .post(`/api/v1/payroll/periods/${payrollPeriodId}/status`)
    .send({ status: 'open', expectedVersion: 1 })
    .expect(201);

  return payrollPeriodId;
};

export const configure = async (http: Server): Promise<Configured> => {
  const { payrollGroupId } = bodyOf<GroupBody>(await defineGroup(http).expect(201));
  const payrollPeriodId = await openPeriod(http, payrollGroupId);

  return { payrollGroupId, payrollPeriodId };
};

export const calculate = async (http: Server, payrollPeriodId: string): Promise<string> => {
  const response = await request(http)
    .post('/api/v1/payroll/runs/calculation')
    .send({ payrollPeriodId })
    .expect(201);

  return bodyOf<RunBody>(response).payrollRunId;
};

/** Calculate, approve as a second human, finalize. The run is immutable afterwards. */
export const finalizedRun = async (http: Server): Promise<string> => {
  const ready = await configure(http);
  const runId = await calculate(http, ready.payrollPeriodId);

  await request(http)
    .post(`/api/v1/payroll/runs/${runId}/approval`)
    .set('x-test-actor', APPROVER)
    .send({})
    .expect(201);
  await request(http)
    .post(`/api/v1/payroll/runs/${runId}/finalization`)
    .set('x-test-actor', APPROVER)
    .expect(201);
  return runId;
};
