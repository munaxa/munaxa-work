import { vi } from 'vitest';

import {
  DEFINITION_ID,
  INSTANCE_ID,
  aDefinition,
  aDefinitionDetail,
  aDelegatedDecision,
  aHistory,
  aPendingApproval,
  anApprovalStatus,
  anInstance,
  anInstanceDetail,
} from './views.fixture';
import { GROUP_ID, aGroup, aGroupDetail } from './branches.fixture';

/**
 * The API this screen is tested against: every path it may ask for, and what each one answers.
 *
 * **Mocked at the HTTP-client boundary and nowhere else.** `globalThis.fetch` is replaced; every
 * layer above it is the real one. Nothing here mocks a repository, a store, an application handler
 * or a domain rule — those are proved by the API suites against real PostgreSQL, and a UI test that
 * stubbed them would be asserting against a product nobody built.
 *
 * Shared by the two suites that split at the file-size budget on the seam the screen itself has:
 * `api.test.ts` asserts **what is asked for**, `api-payload.test.ts` **what is made of the answer**.
 * The table lives here so neither suite can quietly diverge from the other's idea of the API.
 */

export const BASE = 'http://127.0.0.1:3000/api/v1/workflow';

/** Every path the screen is allowed to ask for, and what the API answers with. */
export const RESPONSES: Readonly<Record<string, unknown>> = {
  '/definitions?page=1&size=50': { items: [aDefinition()], total: 4000 },
  '/instances?page=1&size=50': { items: [anInstance()], total: 4000 },
  [`/definitions/${DEFINITION_ID}`]: aDefinitionDetail(),
  [`/instances/${INSTANCE_ID}`]: anInstanceDetail(),
  [`/instances/${INSTANCE_ID}/history?page=1&size=50`]: { items: aHistory(), total: 9 },
  [`/approvals/${INSTANCE_ID}/status`]: anApprovalStatus(),
  '/approval-groups?page=1&size=50': { items: [aGroup()], total: 90 },
  [`/approval-groups/${GROUP_ID}`]: aGroupDetail(),
  '/approvals/pending?page=1&size=50': { items: [aPendingApproval()], total: 12 },
  '/approvals/decided?page=1&size=50': { items: [aDelegatedDecision()], total: 7 },
};

/** The paths a run actually asked for, in order, cleared by each `stub` call. */
export const requested: string[] = [];

const answering = (responder: (path: string) => unknown): void => {
  requested.length = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const path = url.replace(BASE, '');

      requested.push(path);

      const body = responder(path);

      return Promise.resolve({
        ok: body !== undefined,
        status: body === undefined ? 404 : 200,
        json: () => Promise.resolve(body),
      });
    }),
  );
};

/**
 * A fetch that answers from the table above and records what was asked.
 *
 * An unknown path answers 404 rather than throwing, because that is what a real API does for a route
 * this screen should not have called — and a test that threw would report "the screen crashed" where
 * the real defect is "the screen asked for something it should not have".
 */
export const stubFetch = (missing: readonly string[] = []): void => {
  answering((path) => (missing.includes(path) ? undefined : RESPONSES[path]));
};

/** The same API, with every listing returning fifty of its row instead of one. */
export const stubFiftyRows = (): void => {
  answering((path) => {
    const single = RESPONSES[path] as { items?: readonly unknown[] } | undefined;

    if (single?.items === undefined) return single;
    return { ...single, items: Array.from({ length: 50 }, () => single.items?.[0]) };
  });
};

/** A tenant with nothing in it: every listing answers, and answers empty. */
export const stubEmpty = (): void => {
  answering(() => ({ items: [], total: 0 }));
};

/** A service that will not answer at all. */
export const stubUnreachable = (): void => {
  requested.length = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
  );
};
