import {
  Dispatcher,
  runInContext,
  uuidV7,
  type HandlerFailure,
  type PermissionChecker,
  type Result,
} from '@work/kernel';
import { InMemoryUnitOfWork } from '@work/testing';

import { noCountryRules, type CountryRulePort } from '../domain/country-rule.js';
import type {
  AttendanceFacts,
  CompensationFacts,
  EmploymentFacts,
  LeaveFacts,
} from '../domain/payroll-snapshot.js';
import { inMemoryPayrollStores } from './in-memory-stores.js';
import { payrollModule } from './payroll-module.js';
import { ALL_PAYROLL_PERMISSIONS } from './payroll-permissions.js';
import {
  sourceAnswered,
  sourceUnavailable,
  type AttendanceSourcePort,
  type Clock,
  type CompensationSourcePort,
  type EmploymentSourcePort,
  type LeaveSourcePort,
  type OrganizationSourcePort,
  type SourceAnswer,
} from './cross-module-ports.js';

/**
 * The harness the application suites run against: the real module, the real dispatcher, the real
 * handlers — and controllable fakes for the four sources and the database.
 *
 * The fakes are controllable in one specific way that matters: each can be made **unavailable**,
 * and each can have its facts changed underneath a calculated run. Those two levers are what let a
 * suite assert the two properties this module is built around — that an outage is refused rather
 * than paid through, and that a source change is found by asking rather than by being told.
 */

export const TENANT = uuidV7();
export const NOW = new Date('2026-07-01T09:00:00Z');

export const ADMINISTRATOR = 'user:payroll-administrator';
export const APPROVER = 'user:payroll-approver';

export class FixedClock implements Clock {
  public constructor(private moment: Date) {}

  public now(): Date {
    return this.moment;
  }

  public advanceTo(moment: Date): void {
    this.moment = moment;
  }
}

/** One controllable source: a map of facts, and a switch that makes it unreachable. */
class FakeSource<TFacts> {
  private readonly facts = new Map<string, TFacts>();
  private available = true;

  public set(employmentId: string, facts: TFacts): void {
    this.facts.set(employmentId, facts);
  }

  public remove(employmentId: string): void {
    this.facts.delete(employmentId);
  }

  public get(employmentId: string): TFacts | undefined {
    return this.facts.get(employmentId);
  }

  /** Who this source knows about — what "the workforce" means to the harness. */
  public identifiers(): readonly string[] {
    return [...this.facts.keys()];
  }

  public unavailable(): void {
    this.available = false;
  }

  public restored(): void {
    this.available = true;
  }

  public answer(employmentIds: readonly string[]): SourceAnswer<TFacts> {
    if (!this.available) return sourceUnavailable();

    const found = new Map<string, TFacts>();

    for (const employmentId of employmentIds) {
      const facts = this.facts.get(employmentId);

      if (facts !== undefined) found.set(employmentId, facts);
    }
    return sourceAnswered(found);
  }
}

export interface Harness {
  readonly dispatcher: Dispatcher;
  readonly clock: FixedClock;
  readonly employment: FakeSource<EmploymentFacts>;
  readonly compensation: FakeSource<CompensationFacts>;
  readonly attendance: FakeSource<AttendanceFacts>;
  readonly leave: FakeSource<LeaveFacts>;
  readonly organizationUnavailable: () => void;
  as<TResult>(actor: string, work: () => Promise<TResult>): Promise<TResult>;
}

export interface HarnessOptions {
  readonly permissions?: readonly string[];
  readonly countryRules?: CountryRulePort;
  readonly countryCode?: string;
}

export const harnessFor = (options: HarnessOptions = {}): Harness => {
  const granted = options.permissions ?? ALL_PAYROLL_PERMISSIONS;
  const checker: PermissionChecker = {
    holds: (permission) => Promise.resolve(granted.includes(permission)),
  };
  const dispatcher = new Dispatcher(checker);
  const clock = new FixedClock(NOW);
  const employment = new FakeSource<EmploymentFacts>();
  const compensation = new FakeSource<CompensationFacts>();
  const attendance = new FakeSource<AttendanceFacts>();
  const leave = new FakeSource<LeaveFacts>();

  return assembled(options, { dispatcher, clock, employment, compensation, attendance, leave });
};

interface Fakes {
  readonly dispatcher: Dispatcher;
  readonly clock: FixedClock;
  readonly employment: FakeSource<EmploymentFacts>;
  readonly compensation: FakeSource<CompensationFacts>;
  readonly attendance: FakeSource<AttendanceFacts>;
  readonly leave: FakeSource<LeaveFacts>;
}

/** The ports, the module, and the registration — apart because the fakes above are the interesting part. */
const assembled = (options: HarnessOptions, fakes: Fakes): Harness => {
  const { dispatcher, clock, employment, compensation, attendance, leave } = fakes;
  let organizationAvailable = true;

  const employmentPort: EmploymentSourcePort = {
    employmentIds: (_legalEntityId, after, limit) => {
      const all = [...employment.identifiers()].sort();
      const from = after === undefined ? 0 : all.indexOf(after) + 1;

      return Promise.resolve(all.slice(from, from + limit));
    },
    factsFor: (employmentIds) => Promise.resolve(employment.answer(employmentIds)),
  };
  const compensationPort: CompensationSourcePort = {
    factsFor: (employmentIds) => Promise.resolve(compensation.answer(employmentIds)),
    changedSince: () => Promise.resolve([]),
  };
  const attendancePort: AttendanceSourcePort = {
    factsFor: (employmentIds) => Promise.resolve(attendance.answer(employmentIds)),
  };
  const leavePort: LeaveSourcePort = {
    factsFor: (employmentIds) => Promise.resolve(leave.answer(employmentIds)),
  };
  const organizationPort = fakeOrganization(options, () => organizationAvailable);
  const module = payrollModule({
    unitOfWork: new InMemoryUnitOfWork(TENANT),
    stores: inMemoryPayrollStores(),
    employment: employmentPort,
    compensation: compensationPort,
    attendance: attendancePort,
    leave: leavePort,
    organization: organizationPort,
    countryRules: options.countryRules ?? noCountryRules,
    clock,
  });

  for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
  for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);

  return {
    dispatcher,
    clock,
    employment,
    compensation,
    attendance,
    leave,
    organizationUnavailable: () => {
      organizationAvailable = false;
    },
    as: (actor, work) => runInContext({ tenantId: TENANT, correlationId: uuidV7(), actor }, work),
  };
};

/**
 * Organization, and the switch that makes it unreachable.
 *
 * `known: false` is not "no legal entity" — it is "could not be asked" (ADR-0056), and the suite
 * uses it to prove a run refuses rather than calculating a workforce under no statutory rules.
 */
const fakeOrganization = (
  options: HarnessOptions,
  available: () => boolean,
): OrganizationSourcePort => ({
  legalEntity: (legalEntityId) =>
    Promise.resolve(
      available()
        ? {
            known: true,
            entity: {
              legalEntityId,
              countryCode: options.countryCode ?? 'JO',
              currencyCode: 'JOD',
            },
          }
        : { known: false },
    ),
});

/** Sends a command and fails loudly, so a broken step names itself rather than the next one. */
export const send = async <TResult>(
  harness: Harness,
  command: Record<string, unknown>,
): Promise<TResult> => {
  const result = await harness.dispatcher.send<TResult>(command as never);

  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.value;
};

export const attempt = (
  harness: Harness,
  command: Record<string, unknown>,
): Promise<Result<unknown, HandlerFailure>> => harness.dispatcher.send(command as never);

export const ask = async <TResult>(
  harness: Harness,
  query: Record<string, unknown>,
): Promise<TResult> => {
  const result = await harness.dispatcher.ask<TResult>(query as never);

  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.value;
};

export const tryAsk = (
  harness: Harness,
  query: Record<string, unknown>,
): Promise<Result<unknown, HandlerFailure>> => harness.dispatcher.ask(query as never);
