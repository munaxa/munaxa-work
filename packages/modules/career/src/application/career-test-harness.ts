import {
  Dispatcher,
  runInContext,
  uuidV7,
  type HandlerFailure,
  type PermissionChecker,
  type Result,
} from '@work/kernel';
import { InMemoryUnitOfWork } from '@work/testing';

import { inMemoryCareerStores } from './in-memory-stores.js';
import { careerModule } from './career-module.js';
import { ALL_CAREER_PERMISSIONS } from './career-permissions.js';
import type {
  Clock,
  EmploymentFacts,
  EmploymentPort,
  LearningPort,
  OrganizationPort,
  Workforce,
} from './career-ports.js';

/**
 * The harness the application suites run against: the real module, the real dispatcher, the real
 * handlers, the real permission checker — and controllable doubles for the cross-module reads and
 * the database.
 *
 * **The employment double can be made unavailable**, and that is the point. A module that turned
 * "Employment is unreachable" into "this person does not work here" would refuse a valid nomination
 * and, worse, could be made to report a healthy bench for an organization it never looked at. A
 * double with no way to fail could not test the difference.
 *
 * **There is no Performance double and no Documents double**, because there is no port for either.
 * A nine-box band beside a nomination needs a bounded contract that was not authorized (D-5), and a
 * readiness assessment has no evidence column to store a document identifier in. Faking either here
 * would let the suites demonstrate a capability production does not have, which is the most
 * expensive kind of green.
 *
 * **Nothing here schedules anything and nothing here notifies anybody**, so there is no clock to
 * advance into a "due" state and no recorder to assert delivery against. `FixedClock` exists so a
 * *derived* answer — is this expired, is this review due, is this overdue — can be asked on a stated
 * day rather than on whatever day the suite happens to run.
 */

export const TENANT = uuidV7();
export const OTHER_TENANT = uuidV7();
export const NOW = new Date('2026-08-13T09:00:00Z');
export const TODAY = '2026-08-13';

export const HR = 'user:career-hr';
export const MANAGER = 'user:career-manager';
export const ASSESSOR = 'user:career-assessor';

export const EMPLOYMENT = uuidV7();
export const OTHER_EMPLOYMENT = uuidV7();
export const POSITION = uuidV7();
export const OTHER_POSITION = uuidV7();
export const UNIT = uuidV7();
export const LEARNING_ASSIGNMENT = uuidV7();

export class FixedClock implements Clock {
  public constructor(private moment: Date) {}

  public now(): Date {
    return this.moment;
  }

  public advanceTo(moment: Date): void {
    this.moment = moment;
  }
}

/**
 * Employment, as Employment would answer — including the answer "I cannot answer".
 *
 * The `size` and `page` are honoured rather than ignored: a double that returned everything would
 * let an unbounded read pass a test the production adapter would fail.
 */
export class FakeEmployment implements EmploymentPort {
  private readonly known = new Map<string, EmploymentFacts>();
  private reachable = true;

  public add(facts: EmploymentFacts): void {
    this.known.set(facts.employmentId, facts);
  }

  public end(employmentId: string): void {
    const held = this.known.get(employmentId);

    if (held !== undefined) {
      this.known.set(employmentId, { ...held, active: false, status: 'ended' });
    }
  }

  /** Makes every read fail to answer. Nothing here returns an empty list instead. */
  public becomeUnavailable(): void {
    this.reachable = false;
  }

  public factsFor(employmentId: string): Promise<EmploymentFacts | undefined> {
    return Promise.resolve(this.reachable ? this.known.get(employmentId) : undefined);
  }

  public inPosition(
    positionId: string,
    _asOf: string,
    size: number,
    page: number,
  ): Promise<Workforce> {
    if (!this.reachable) return Promise.resolve(undefined);

    const offset = (Math.max(1, page) - 1) * size;

    return Promise.resolve(
      [...this.known.values()]
        .filter((facts) => facts.active && facts.positionId === positionId)
        .slice(offset, offset + size),
    );
  }
}

/** Organization, answering existence and nothing else. There is no criticality here (D-4, AD-004). */
export class FakeOrganization implements OrganizationPort {
  private readonly positions = new Set<string>();
  private readonly units = new Set<string>();

  public addPosition(positionId: string): void {
    this.positions.add(positionId);
  }

  public addUnit(unitId: string): void {
    this.units.add(unitId);
  }

  public positionExists(positionId: string): Promise<boolean> {
    return Promise.resolve(this.positions.has(positionId));
  }

  public unitExists(unitId: string): Promise<boolean> {
    return Promise.resolve(this.units.has(unitId));
  }
}

/**
 * Learning, answering that an assignment exists.
 *
 * It answers **only** that. There is no completion, no title and no progress on this double, because
 * there is none on the port — Career stores a reference and Learning keeps the status (ADR-0073).
 */
export class FakeLearning implements LearningPort {
  private readonly assignments = new Set<string>();

  public add(assignmentId: string): void {
    this.assignments.add(assignmentId);
  }

  public assignmentExists(assignmentId: string): Promise<boolean> {
    return Promise.resolve(this.assignments.has(assignmentId));
  }
}

export interface Harness {
  readonly dispatcher: Dispatcher;
  readonly clock: FixedClock;
  readonly employment: FakeEmployment;
  readonly organization: FakeOrganization;
  readonly learning: FakeLearning;
  readonly stores: ReturnType<typeof inMemoryCareerStores>;
  as<TResult>(actor: string, work: () => Promise<TResult>): Promise<TResult>;
  inTenant<TResult>(
    tenantId: string,
    actor: string,
    work: () => Promise<TResult>,
  ): Promise<TResult>;
}

export interface HarnessOptions {
  readonly permissions?: readonly string[];
  readonly tenantId?: string;
}

/**
 * A harness with the usual cast already known: one employment, one colleague, two positions, a unit
 * and a Learning assignment.
 *
 * Seeded rather than left empty because almost every suite needs them, and a suite that had to
 * remember to register an employment before every nomination would eventually forget and then assert
 * on the wrong refusal.
 */
export const harnessFor = (options: HarnessOptions = {}): Harness => {
  const granted = options.permissions ?? ALL_CAREER_PERMISSIONS;
  const permissions: PermissionChecker = {
    holds: (permission) => Promise.resolve(granted.includes(permission)),
  };
  const dispatcher = new Dispatcher(permissions);
  const clock = new FixedClock(NOW);
  const employment = new FakeEmployment();
  const organization = new FakeOrganization();
  const learning = new FakeLearning();
  const stores = inMemoryCareerStores();
  const tenantId = options.tenantId ?? TENANT;

  employment.add({
    employmentId: EMPLOYMENT,
    status: 'active',
    active: true,
    positionId: POSITION,
  });
  employment.add({ employmentId: OTHER_EMPLOYMENT, status: 'active', active: true });
  organization.addPosition(POSITION);
  organization.addPosition(OTHER_POSITION);
  organization.addUnit(UNIT);
  learning.add(LEARNING_ASSIGNMENT);

  const module = careerModule({
    unitOfWork: new InMemoryUnitOfWork(tenantId),
    stores,
    employment,
    organization,
    learning,
    permissions,
    clock,
  });

  for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
  for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);

  return {
    dispatcher,
    clock,
    employment,
    organization,
    learning,
    stores,
    as: (actor, work) => runInContext({ tenantId, correlationId: uuidV7(), actor }, work),
    inTenant: (otherTenant, actor, work) =>
      runInContext({ tenantId: otherTenant, correlationId: uuidV7(), actor }, work),
  };
};

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

/** The reason a refusal gives, for assertions that care which rule refused. */
export const reasonOf = (result: Result<unknown, HandlerFailure>): string => {
  if (result.ok) return 'accepted';
  if (result.error.kind === 'rejected') return result.error.reason;
  if (result.error.kind === 'conflict') return result.error.reason;
  if (result.error.kind === 'not_found') return `not_found:${result.error.resource}`;
  if (result.error.kind === 'forbidden') return `forbidden:${result.error.permission}`;
  return 'validation';
};

/** English and Arabic, for every name a command takes. */
export const named = (en: string, ar: string): { readonly en: string; readonly ar: string } => ({
  en,
  ar,
});
