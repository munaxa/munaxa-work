import {
  Dispatcher,
  runInContext,
  uuidV7,
  type HandlerFailure,
  type PermissionChecker,
  type Result,
} from '@work/kernel';
import { InMemoryUnitOfWork } from '@work/testing';

import { inMemoryRelationsStores, type InMemoryRelationsStores } from './in-memory-stores.js';
import { relationsModule } from './relations-module.js';
import { ALL_RELATIONS_PERMISSIONS } from './relations-permissions.js';
import type { Clock, EmploymentDirectoryPort, MembershipDirectoryPort } from './relations-ports.js';

/**
 * The harness the application suites run against: the real module, the real dispatcher, the real
 * handlers — and controllable fakes for the one cross-module read and the database.
 *
 * **Employment is faked, not assumed.** An employment absent from `FakeEmployments` is refused, not
 * invented, so a suite can prove that a violation cannot be filed against an identifier Employment
 * does not recognise — which is the same answer another tenant's employment gets.
 *
 * **Identity is faked the same way**, for the same reason: a membership absent from
 * `FakeMemberships` may not act, so a suite can prove an investigator is verified rather than
 * accepted. Both fakes start empty, so a test that forgets to arrange one meets a refusal rather
 * than a pass.
 */

export const TENANT = uuidV7();
export const NOW = new Date('2026-08-22T09:00:00Z');

export const OFFICER = 'user:relations-officer';
export const ADMINISTRATOR = 'user:relations-administrator';

export class FixedClock implements Clock {
  public constructor(private moment: Date) {}

  public now(): Date {
    return this.moment;
  }

  public advanceTo(moment: Date): void {
    this.moment = moment;
  }
}

/** Which employments exist, as Employment would answer. One absent here is refused, not invented. */
export class FakeEmployments implements EmploymentDirectoryPort {
  private readonly known = new Set<string>();

  public add(employmentId: string): void {
    this.known.add(employmentId);
  }

  public exists(employmentId: string): Promise<boolean> {
    return Promise.resolve(this.known.has(employmentId));
  }
}

/** Which memberships may act, as Identity would answer. Absent means no — never a silent yes. */
export class FakeMemberships implements MembershipDirectoryPort {
  private readonly acting = new Set<string>();

  public add(membershipId: string): void {
    this.acting.add(membershipId);
  }

  public canAct(membershipId: string): Promise<boolean> {
    return Promise.resolve(this.acting.has(membershipId));
  }
}

/** The membership every investigation suite assigns as investigator, unless it is proving otherwise. */
export const INVESTIGATOR = '01940000-0000-7000-8000-00000000c001';

export interface Harness {
  readonly dispatcher: Dispatcher;
  readonly clock: FixedClock;
  readonly employments: FakeEmployments;
  readonly memberships: FakeMemberships;
  readonly stores: InMemoryRelationsStores;
  as<TResult>(actor: string, work: () => Promise<TResult>): Promise<TResult>;
}

export interface HarnessOptions {
  readonly permissions?: readonly string[];
}

export const harnessFor = (options: HarnessOptions = {}): Harness => {
  const granted = options.permissions ?? ALL_RELATIONS_PERMISSIONS;
  const permissions: PermissionChecker = {
    holds: (permission) => Promise.resolve(granted.includes(permission)),
  };
  const dispatcher = new Dispatcher(permissions);
  // The module receives the *same* checker the pipeline uses, so a suite cannot grant a permission
  // to the route and withhold it from the findings rule, or the reverse.
  const clock = new FixedClock(NOW);
  const employments = new FakeEmployments();
  const memberships = new FakeMemberships();
  const stores = inMemoryRelationsStores();
  const module = relationsModule({
    unitOfWork: new InMemoryUnitOfWork(TENANT),
    stores,
    employments,
    memberships,
    permissions,
    clock,
  });

  for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
  for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);

  return {
    dispatcher,
    clock,
    employments,
    memberships,
    stores,
    as: (actor, work) => runInContext({ tenantId: TENANT, correlationId: uuidV7(), actor }, work),
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

/** A catalogue entry, defined through the real command. Overrides ride on top. */
export const givenCategory = async (
  harness: Harness,
  overrides: Record<string, unknown> = {},
): Promise<string> => {
  const created = await harness.as(ADMINISTRATOR, () =>
    send<{ violationCategoryId: string }>(harness, {
      commandName: 'relations.define-category',
      code: 'unauthorized-absence',
      name: { en: 'Unauthorized absence', ar: 'غياب غير مصرح به' },
      severity: 'major',
      sequence: 10,
      repeatWindowDays: 180,
      source: 'tenant',
      ...overrides,
    }),
  );

  return created.violationCategoryId;
};

/** A violation, recorded through the real command, against an employment this harness knows. */
export const givenViolation = async (
  harness: Harness,
  overrides: Record<string, unknown> = {},
): Promise<string> => {
  const employmentId = (overrides.employmentId as string | undefined) ?? uuidV7();

  harness.employments.add(employmentId);

  const categoryId =
    (overrides.violationCategoryId as string | undefined) ?? (await givenCategory(harness));
  const recorded = await harness.as(OFFICER, () =>
    send<{ violationId: string }>(harness, {
      commandName: 'relations.record-violation',
      employmentId,
      violationCategoryId: categoryId,
      occurredOn: '2026-08-20',
      description: 'Absent for three consecutive shifts without notifying the supervisor.',
      ...overrides,
    }),
  );

  return recorded.violationId;
};

/** An open investigation into a fresh violation, through the real commands. */
export const givenInvestigation = async (
  harness: Harness,
  overrides: Record<string, unknown> = {},
): Promise<{ readonly violationId: string; readonly investigationId: string }> => {
  const violationId =
    (overrides.violationId as string | undefined) ?? (await givenViolation(harness));

  harness.memberships.add(INVESTIGATOR);

  const opened = await harness.as(OFFICER, () =>
    send<{ investigationId: string }>(harness, {
      commandName: 'relations.open-investigation',
      violationId,
      investigatorMembershipId: INVESTIGATOR,
      openedOn: '2026-08-21',
      subject: 'Three consecutive unnotified absences',
      reason: 'The supervisor asked for the absences to be looked into.',
      ...overrides,
    }),
  );

  return { violationId, investigationId: opened.investigationId };
};

/** An inquiry taken all the way to a conclusion, through the real commands. */
export const givenConcludedInvestigation = async (
  harness: Harness,
  overrides: Record<string, unknown> = {},
): Promise<{ readonly violationId: string; readonly investigationId: string }> => {
  const opened = await givenInvestigation(harness, overrides);

  await harness.as(OFFICER, () =>
    send(harness, {
      commandName: 'relations.conclude-investigation',
      investigationId: opened.investigationId,
      findings: 'The absences were unnotified and the shift log confirms them.',
      recommendation: 'A written warning.',
      concludedOn: '2026-08-22',
      reason: 'The investigator has reported.',
    }),
  );

  return opened;
};
