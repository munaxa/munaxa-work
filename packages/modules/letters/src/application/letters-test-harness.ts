import {
  Dispatcher,
  runInContext,
  uuidV7,
  type HandlerFailure,
  type PermissionChecker,
  type Result,
} from '@work/kernel';
import { InMemoryUnitOfWork } from '@work/testing';

import { inMemoryLettersStores } from './in-memory-stores.js';
import { lettersModule } from './letters-module.js';
import { ALL_LETTERS_PERMISSIONS } from './letters-permissions.js';
import type {
  Clock,
  LetterSourcePort,
  LetterSources,
  LetterSubject,
  SourceFacts,
  VerificationTokenPort,
} from './letters-ports.js';
import type { ExposableField } from '../domain/letters-vocabulary.js';

/**
 * The harness the application suites run against: the real module, the real dispatcher, the real
 * handlers — and controllable fakes for the sources, the clock and the database.
 *
 * The sources are controllable in the two ways that matter: their facts can **change underneath an
 * issued letter**, which is how a suite proves the frozen snapshot really is frozen, and each can be
 * made **unavailable**, which is how a suite proves an outage refuses the letter rather than
 * rendering a blank where a salary belongs.
 */

export const TENANT = uuidV7();
export const NOW = new Date('2026-08-11T09:00:00Z');

export const ADMINISTRATOR = 'user:letters-administrator';
export const REQUESTER = 'user:letters-requester';
export const APPROVER = 'user:letters-approver';

export class FixedClock implements Clock {
  public constructor(private moment: Date) {}

  public now(): Date {
    return this.moment;
  }

  public advanceTo(moment: Date): void {
    this.moment = moment;
  }
}

/** One controllable source: a map of values, a version, and a switch that makes it unreachable. */
export class FakeSource implements LetterSourcePort {
  private values: Record<string, string> = {};
  private sourceVersion = '1';
  private available = true;

  public set(values: Record<string, string>, sourceVersion = '1'): void {
    this.values = values;
    this.sourceVersion = sourceVersion;
  }

  public unavailable(): void {
    this.available = false;
  }

  public restored(): void {
    this.available = true;
  }

  public factsFor(_subject: LetterSubject): Promise<SourceFacts | undefined> {
    // `undefined` is an outage, not an empty answer. The distinction is the point of this switch.
    if (!this.available) return Promise.resolve(undefined);
    return Promise.resolve({ values: this.values, sourceVersion: this.sourceVersion });
  }
}

/**
 * A token that is unique per call and long enough for the domain's minimum.
 *
 * Deterministic on purpose so a suite can assert *which* letter a token verifies. Production wires
 * `randomVerificationToken`, which is the only implementation that reaches a random source.
 */
export class SequentialTokens implements VerificationTokenPort {
  private issued = 0;

  public issue(): string {
    this.issued += 1;
    return tokenNumber(this.issued);
  }

  /** The token the nth letter received, so a suite can assert *which* letter a token verifies. */
  public nth(ordinal: number): string {
    return tokenNumber(ordinal);
  }
}

const tokenNumber = (ordinal: number): string => `token-${String(ordinal).padStart(58, '0')}`;

export interface Harness {
  readonly dispatcher: Dispatcher;
  readonly clock: FixedClock;
  readonly tokens: SequentialTokens;
  readonly person: FakeSource;
  readonly employment: FakeSource;
  readonly organization: FakeSource;
  readonly salary: FakeSource;
  as<TResult>(actor: string, work: () => Promise<TResult>): Promise<TResult>;
}

export interface HarnessOptions {
  readonly permissions?: readonly string[];
  /** Which sources are wired at all. A field absent here refuses rather than resolving to blanks. */
  readonly wired?: readonly ExposableField[];
}

export const harnessFor = (options: HarnessOptions = {}): Harness => {
  const granted = options.permissions ?? ALL_LETTERS_PERMISSIONS;
  const permissions: PermissionChecker = {
    holds: (permission) => Promise.resolve(granted.includes(permission)),
  };
  const dispatcher = new Dispatcher(permissions);
  const clock = new FixedClock(NOW);
  const tokens = new SequentialTokens();
  const parts = {
    person: new FakeSource(),
    employment: new FakeSource(),
    organization: new FakeSource(),
    salary: new FakeSource(),
  };

  parts.person.set({ fullName: 'Layla Haddad' });
  parts.employment.set({ startDate: '2024-03-01', jobTitle: 'Engineer' });
  parts.organization.set({ legalName: 'Munaxa LLC' });
  parts.salary.set({ monthly: '1200.000 JOD' });

  const module = lettersModule({
    unitOfWork: new InMemoryUnitOfWork(TENANT),
    stores: inMemoryLettersStores(),
    sources: sourcesFor(options, parts),
    tokens,
    permissions,
    clock,
  });

  for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
  for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);

  return {
    dispatcher,
    clock,
    tokens,
    ...parts,
    as: (actor, work) => runInContext({ tenantId: TENANT, correlationId: uuidV7(), actor }, work),
  };
};

type Parts = Readonly<Record<'person' | 'employment' | 'organization' | 'salary', FakeSource>>;

const ALL_WIRED: readonly ExposableField[] = ['person', 'employment', 'organization', 'salary'];

const sourcesFor = (options: HarnessOptions, parts: Parts): LetterSources => {
  const wired = options.wired ?? ALL_WIRED;

  return Object.fromEntries(
    ALL_WIRED.filter((field) => wired.includes(field)).map((field) => [
      field,
      parts[field as keyof Parts],
    ]),
  );
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
