import type { Server } from 'node:http';

import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loadEnvironment } from '@work/config';
import {
  Dispatcher,
  GrantAwarePermissionChecker,
  runInContext,
  uuidV7,
  type PermissionChecker,
} from '@work/kernel';
import {
  ALL_DOCUMENTS_PERMISSIONS,
  DocumentAccessController,
  DocumentController,
  DocumentTypeController,
  DocumentVersionController,
  DocumentsDispatcher,
  documentsModule,
  inMemoryDocumentsStores,
  storageUnavailable,
} from '@work/documents';
import {
  ALL_LETTERS_PERMISSIONS,
  IssuedLetterController,
  LetterIssuanceController,
  LetterRequestController,
  LetterTemplateController,
  LettersDispatcher,
  inMemoryLettersStores,
  lettersModule,
} from '@work/letters';
import { InMemoryUnitOfWork } from '@work/testing';

import { configureApplication } from '../application.setup.js';
import { AuthenticatedTenantGuard } from '../tenancy/authenticated-tenant.guard.js';
import { DocumentsOwnerDirectory, DocumentsPersonIdentifiers } from './documents-sources.js';
import {
  LetterEmploymentSource,
  LetterOrganizationSource,
  LetterPersonSource,
  LetterSalarySource,
} from '../letters/letters-sources.js';
import { upstream, upstreamHandlers } from './phase-twelve-upstream.js';

/**
 * The composition the Documents and Letters API specs share: the **real controllers**, the real
 * dispatcher, the real global filter and validation pipe, over in-memory stores.
 *
 * Shared rather than repeated because a spec that assembles the application slightly differently
 * from production proves nothing about production. The controllers are declared in the same order
 * the Nest modules declare them, because that order is what makes `GET /documents/types` resolve to
 * the type listing rather than to a document whose identifier happens to be `types`.
 *
 * Tenant isolation is deliberately **not** tested here: these stores are not tenant-scoped, because
 * in production row-level security is what scopes them. That proof belongs against real PostgreSQL
 * and lives in the modules' own isolation suites.
 */

export const TENANT = uuidV7();
export const NOW = new Date('2026-08-11T09:00:00Z');

export const ADMINISTRATOR = 'user:hr-administrator';
export const VERIFIER = 'user:hr-verifier';

export const ALL: readonly string[] = [...ALL_DOCUMENTS_PERMISSIONS, ...ALL_LETTERS_PERMISSIONS];

/**
 * Wrapped exactly as the composition root wraps it.
 *
 * `GrantAwarePermissionChecker` is what makes a bounded service grant mean anything: without it an
 * adapter's grant is inert and every cross-module read is refused, which is what a plain checker
 * proved the first time the cross-module suite ran.
 */
export const permitting = (...granted: readonly string[]): PermissionChecker =>
  new GrantAwarePermissionChecker({
    holds: (permission) => Promise.resolve(granted.includes(permission)),
  });

const environment = loadEnvironment({
  APP_NAME: 'munaxa-work-test',
  APP_VERSION: '0.0.0-test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/work',
});

export interface HarnessOptions {
  /** Omitted means every request arrives with no authenticated context at all. */
  readonly actor?: string | undefined;
}

const dispatcherFor = (checker: PermissionChecker): Dispatcher => {
  const dispatcher = new Dispatcher(checker);
  const unitOfWork = new InMemoryUnitOfWork(TENANT);
  const asking = { ask: dispatcher.ask.bind(dispatcher) };
  const clock = { now: () => NOW };

  for (const handler of upstreamHandlers(upstream())) dispatcher.registerQuery(handler);

  const modules = [
    documentsModule({
      unitOfWork,
      stores: inMemoryDocumentsStores(),
      owners: new DocumentsOwnerDirectory(asking),
      identifiers: new DocumentsPersonIdentifiers(asking),
      // No adapter exists. The API reports that honestly; it never fabricates a link.
      storage: storageUnavailable,
      permissions: checker,
      clock,
    }),
    lettersModule({
      unitOfWork,
      stores: inMemoryLettersStores(),
      sources: {
        person: new LetterPersonSource(asking),
        employment: new LetterEmploymentSource(asking),
        organization: new LetterOrganizationSource(asking),
        salary: new LetterSalarySource(asking, () => '2026-08-11'),
      },
      tokens: { issue: () => uuidV7().replace(/-/g, '').padEnd(64, '0') },
      permissions: checker,
      clock,
    }),
  ];

  for (const module of modules) {
    for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
    for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);
  }
  return dispatcher;
};

export const applicationWith = async (
  checker: PermissionChecker,
  options: HarnessOptions = { actor: ADMINISTRATOR },
): Promise<INestApplication> => {
  const dispatcher = dispatcherFor(checker);
  const testing = await Test.createTestingModule({
    // The same order the Nest modules declare, because that order is what makes
    // `GET /documents/types` resolve to the type listing rather than to a document.
    controllers: [
      DocumentTypeController,
      DocumentController,
      DocumentVersionController,
      DocumentAccessController,
      LetterTemplateController,
      LetterRequestController,
      LetterIssuanceController,
      IssuedLetterController,
    ],
    providers: [
      { provide: DocumentsDispatcher, useValue: new DocumentsDispatcher(dispatcher) },
      { provide: LettersDispatcher, useValue: new LettersDispatcher(dispatcher) },
      { provide: APP_GUARD, useClass: AuthenticatedTenantGuard },
    ],
  }).compile();

  const application = testing.createNestApplication();

  // Stands in for the authenticated identity Platform will supply. `x-test-actor` lets one scenario
  // act as two people, which is the only way to approve a letter somebody else requested — the
  // database refuses `decided_by = requested_by` and the domain refuses it before that. With no
  // actor configured nothing is established, which is what an unauthenticated caller sees.
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

export const http = (application: INestApplication): request.Agent =>
  request(application.getHttpServer() as Server);

/**
 * The published shapes these specs read, and the one cast per read that produces them.
 *
 * `supertest` types a response body as `any`, and reaching into it directly would put an implicit
 * `any` on every assertion in the suite.
 */
export interface DownloadBody {
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly available: boolean;
  readonly url?: string;
  readonly expiresInSeconds: number;
}

export interface PageBody<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

export interface DocumentItem {
  readonly documentId: string;
  readonly confidentiality: string;
  readonly expiryState: string;
  readonly expiryOwnedByPeople: boolean;
}

export interface VerificationBody {
  readonly genuine: boolean;
  readonly referenceNumber?: string;
}
