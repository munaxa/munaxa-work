import 'reflect-metadata';

import {
  Dispatcher,
  GrantAwarePermissionChecker,
  runInContext,
  uuidV7,
  type Command,
  type HandlerFailure,
  type PermissionChecker,
  type Query,
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
import { upstreamHandlers, type UpstreamFacts } from './phase-twelve-upstream.js';
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

export { EMPLOYMENT_ID, IDENTIFIER_ID, LEGAL_ENTITY_ID, PERSON_ID, UNIT_ID } from './phase-twelve-upstream.js';
export type { UpstreamFacts } from './phase-twelve-upstream.js';

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
 * The starting facts the four upstream modules publish.
 *
 * Mutable on purpose: a suite changes a salary or an identifier's expiry *here* and asks the
 * modules under test what they now say. That is how the D-1a boundary and the frozen letter
 * snapshot are both proved — one must move with the source, the other must not.
 */
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
