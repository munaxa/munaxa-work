import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import approvalsPage from '../app/approvals/page';
import approvalPage from '../app/approvals/[instanceId]/page';

import { approvalsTranslator } from './locale';
import {
  aDirectDecision,
  aHistoryEntry,
  aPendingApproval,
  anApprovalStatus,
  anInstanceDetail,
} from './approvals.fixture';

/**
 * Both routes, end to end: a request in, Workflow's answers, and the HTML a browser gets.
 *
 * The section suites prove each region renders what the module returned. Only this proves the routes
 * work — that the parameters are read, that the instance is resolved before anything else is asked,
 * that an unresolvable instance is a 404 rather than a page of refusals, and that direction follows
 * language on the element wrapping all of it.
 */

const BASE = 'http://127.0.0.1:3000/api/v1/workflow';
const INSTANCE = '01900000-0000-7000-8000-00000000i001';

const en = approvalsTranslator('en');

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const ANSWERS: readonly (readonly [string, () => unknown])[] = [
  ['/approvals/pending', () => ({ items: [aPendingApproval()], total: 317 })],
  ['/approvals/decided', () => ({ items: [aDirectDecision()], total: 42 })],
  [`/instances/${INSTANCE}/history`, () => ({ items: [aHistoryEntry()], total: 9 })],
  [`/approvals/${INSTANCE}/status`, anApprovalStatus],
  [`/instances/${INSTANCE}`, anInstanceDetail],
];

const answerEverything = (): void => {
  vi.stubGlobal('fetch', (input: string) => {
    const path = (input.slice(BASE.length).split('?')[0] ?? '').toString();
    const hit = ANSWERS.find(([prefix]) => path.startsWith(prefix));

    return Promise.resolve(hit === undefined ? new Response('', { status: 404 }) : json(hit[1]()));
  });
};

const refuseEverything = (): void => {
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 403 })));
};

const queue = async (lang?: string): Promise<string> =>
  renderToStaticMarkup(
    (await approvalsPage({
      searchParams: Promise.resolve(lang === undefined ? {} : { lang }),
    })) as ReactNode,
  );

const approval = async (lang?: string): Promise<string> =>
  renderToStaticMarkup(
    (await approvalPage({
      params: Promise.resolve({ instanceId: INSTANCE }),
      searchParams: Promise.resolve(lang === undefined ? {} : { lang }),
    })) as ReactNode,
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the approvals route', () => {
  it('puts the queue, the totals and the service level on one page', async () => {
    answerEverything();

    const markup = await queue();

    expect(markup).toContain('REQUISITION-APPROVAL');
    expect(markup).toContain('recruitment.requisition');
    expect(markup).toContain('317');
    expect(markup).toContain('42');
    expect(markup).toContain(en('workflow.vocabulary.serviceLevelState.overdue'));
    expect(markup).toContain('dir="ltr"');
  });

  it('renders right to left in Arabic', async () => {
    answerEverything();

    const markup = await queue('ar');

    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('lang="ar"');
  });

  /**
   * The state every deployment without Platform's authentication adapter is in.
   *
   * The permission is checked before the handler runs, so both queues are refused. The screen must
   * say it may not look — never that the queue is clear.
   */
  it('says the queue was withheld, never that it is clear', async () => {
    refuseEverything();

    const markup = await queue();

    expect(markup).toContain(en('admin.notice.sectionWithheld'));
    expect(markup).not.toContain(en('admin.approvals.nothingWaiting'));
    // No count is invented for a queue nobody could read.
    expect(markup).not.toContain('317');
  });
});

describe('the approval route', () => {
  it('resolves the instance first, then asks for the rest', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', (input: string) => {
      asked.push(input);
      const path = (input.slice(BASE.length).split('?')[0] ?? '').toString();
      const hit = ANSWERS.find(([prefix]) => path.startsWith(prefix));

      return Promise.resolve(
        hit === undefined ? new Response('', { status: 404 }) : json(hit[1]()),
      );
    });

    await approval();

    expect(asked[0]).toBe(`${BASE}/instances/${INSTANCE}`);
    expect(asked).toHaveLength(3);
  });

  it('puts the chain, the branch, the decisions and the timeline on one page', async () => {
    answerEverything();

    const markup = await approval();

    expect(markup).toContain(en('workflow.vocabulary.stepStatus.awaiting'));
    expect(markup).toContain(en('workflow.vocabulary.branchRule.majority'));
    expect(markup).toContain(en('workflow.vocabulary.authority.delegated'));
    expect(markup).toContain(en('workflow.vocabulary.historyEvent.step-awaiting'));
    expect(markup).toContain('2880');
    expect(markup).toContain('9');
  });

  it('links back to the queue', async () => {
    answerEverything();

    expect(await approval()).toContain('href="/approvals?lang=en"');
  });

  /**
   * An identifier the API will not resolve is a 404, not a page of refusals about an approval that
   * may not exist. `notFound()` throws Next's own control-flow error.
   */
  it('answers not found rather than rendering an approval nobody could read', async () => {
    refuseEverything();

    await expect(approval()).rejects.toThrow();
  });

  it('asks for nothing else once the instance refused', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', (input: string) => {
      asked.push(input);
      return Promise.resolve(new Response('', { status: 403 }));
    });

    await expect(approval()).rejects.toThrow();
    expect(asked).toEqual([`${BASE}/instances/${INSTANCE}`]);
  });
});
