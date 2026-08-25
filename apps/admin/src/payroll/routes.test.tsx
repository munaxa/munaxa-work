import { readFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import payrollPage from '../app/payroll/page';
import payrollLoading from '../app/payroll/loading';
import runPage from '../app/payroll/runs/[payrollRunId]/page';
import runNotFound from '../app/payroll/runs/[payrollRunId]/not-found';
import resultPage from '../app/payroll/results/[payrollResultId]/page';
import resultNotFound from '../app/payroll/results/[payrollResultId]/not-found';
import { DESTINATIONS } from '../shell/navigation';

import { payrollTranslator } from './locale';
import {
  aDashboard,
  aGroup,
  aPayslip,
  aPeriod,
  aRun,
  anEarlierRun,
  anAccountingLine,
  anAdjustment,
  anApprovalChain,
  anException,
  aPaymentInstruction,
  aReconciliationRecord,
  aResult,
} from './payroll.fixture';

/**
 * All three routes, end to end: a request in, Payroll's answers, and the HTML a browser gets.
 *
 * The section suites prove each region renders what the module returned. Only this proves the routes
 * work — that the parameters are read, that the subject is resolved before anything else is asked,
 * that an unresolvable identifier is a 404 rather than a page about somebody else's payroll, and
 * that direction follows language on the element wrapping all of it.
 */

const BASE = 'http://127.0.0.1:3000/api/v1/payroll';
const RUN = '01900000-0000-7000-8000-0000000000n1';
const RESULT = '01900000-0000-7000-8000-0000000000t1';

const en = payrollTranslator('en');

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const ANSWERS: readonly (readonly [string, () => unknown])[] = [
  ['/dashboard', aDashboard],
  ['/runs?', () => ({ items: [aRun(), anEarlierRun()], total: 26 })],
  ['/periods?', () => ({ items: [aPeriod()], total: 14 })],
  ['/groups', () => ({ items: [aGroup()], total: 1 })],
  ['/deduction-definitions', () => ({ items: [] })],
  ['/results?', () => ({ items: [aResult()], total: 1398 })],
  ['/exceptions', () => ({ items: [anException()] })],
  ['/adjustments', () => ({ items: [anAdjustment()] })],
  ['/approval-chain', anApprovalChain],
  ['/reconciliation', () => ({ items: [aReconciliationRecord()] })],
  ['/accounting-output', () => ({ items: [anAccountingLine()], total: 2796 })],
  ['/payment-instructions', () => ({ items: [aPaymentInstruction()], total: 1398 })],
  ['/payslip', aPayslip],
  [`/runs/${RUN}`, aRun],
];

const answerEverything = (): void => {
  vi.stubGlobal('fetch', (input: string) => {
    const path = input.slice(BASE.length);
    const hit = ANSWERS.find(([fragment]) =>
      fragment.startsWith(`/runs/${RUN}`) ? path === fragment : path.includes(fragment),
    );

    return Promise.resolve(hit === undefined ? new Response('', { status: 404 }) : json(hit[1]()));
  });
};

const refuseEverything = (): void => {
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 401 })));
};

const workspace = async (lang?: string): Promise<string> =>
  renderToStaticMarkup(
    (await payrollPage({
      searchParams: Promise.resolve(lang === undefined ? {} : { lang }),
    })) as ReactNode,
  );

const run = async (lang?: string): Promise<string> =>
  renderToStaticMarkup(
    (await runPage({
      params: Promise.resolve({ payrollRunId: RUN }),
      searchParams: Promise.resolve(lang === undefined ? {} : { lang }),
    })) as ReactNode,
  );

const result = async (lang?: string): Promise<string> =>
  renderToStaticMarkup(
    (await resultPage({
      params: Promise.resolve({ payrollResultId: RESULT }),
      searchParams: Promise.resolve(lang === undefined ? {} : { lang }),
    })) as ReactNode,
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the payroll workspace route', () => {
  it('puts the overview, every run and the configuration on one page', async () => {
    answerEverything();

    const markup = await workspace();

    expect(markup).toContain('26');
    expect(markup).toContain(en('payroll.label.runs'));
    expect(markup).toContain('Head office');
    expect(markup).toContain('dir="ltr"');
  });

  it('renders right to left in Arabic', async () => {
    answerEverything();

    const markup = await workspace('ar');

    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('lang="ar"');
    expect(markup).toContain('المركز الرئيسي');
  });

  it('says the refusal once, never that there is no payroll', async () => {
    refuseEverything();

    const markup = await workspace();

    expect(markup).toContain(en('payroll.label.nothingReadable'));
    expect(markup).toContain(en('payroll.notice.unauthenticated'));
    expect(markup).not.toContain(en('payroll.label.noRuns'));
  });
});

describe('the payroll run route', () => {
  it('resolves the run first, then asks for the rest', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', (input: string) => {
      asked.push(input);
      const path = input.slice(BASE.length);
      const hit = ANSWERS.find(([fragment]) =>
        fragment.startsWith(`/runs/${RUN}`) ? path === fragment : path.includes(fragment),
      );

      return Promise.resolve(
        hit === undefined ? new Response('', { status: 404 }) : json(hit[1]()),
      );
    });

    await run();

    expect(asked[0]).toBe(`${BASE}/runs/${RUN}`);
    expect(asked).toHaveLength(8);
  });

  it('names the run it was asked for, and opens its results', async () => {
    answerEverything();

    const markup = await run();

    expect(markup).toContain('14');
    expect(markup).toContain(en('payroll.status.calculated'));
    expect(markup).toContain(`href="/payroll/results/${RESULT}?lang=en"`);
  });

  it('links back to payroll', async () => {
    answerEverything();

    expect(await run()).toContain('href="/payroll?lang=en"');
  });

  it('answers not found rather than rendering a payroll nobody could read', async () => {
    refuseEverything();

    await expect(run()).rejects.toThrow();
  });

  it('asks for nothing else once the run refused', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', (input: string) => {
      asked.push(input);
      return Promise.resolve(new Response('', { status: 401 }));
    });

    await expect(run()).rejects.toThrow();
    expect(asked).toEqual([`${BASE}/runs/${RUN}`]);
  });

  it('renders a not-found page that says the API returned nothing, and offers a way back', () => {
    const markup = renderToStaticMarkup(runNotFound());

    expect(markup).toContain(en('payroll.label.runNotFound'));
    expect(markup).toContain('href="/payroll"');
  });
});

describe('the payroll result route', () => {
  it('reads the payslip once and renders the period it publishes', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', (input: string) => {
      asked.push(input);
      return Promise.resolve(json(aPayslip()));
    });

    const markup = await result();

    expect(asked).toHaveLength(1);
    expect(markup).toContain('2026-08');
    expect(markup).toContain('1575.500');
  });

  it('answers not found when the figures are refused', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 403 })));

    await expect(result()).rejects.toThrow();
  });

  it('renders a not-found page that names the separate permission', () => {
    const markup = renderToStaticMarkup(resultNotFound());

    expect(markup).toContain(en('payroll.label.resultNotFound'));
    expect(markup).toContain('href="/payroll"');
  });
});

describe('the frame around all three', () => {
  it('renders a loading state that holds the layout and invents no figure', () => {
    const markup = renderToStaticMarkup(payrollLoading());

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('animate-pulse');
    expect(markup.replace(/<[^>]*>/g, '').trim()).toBe('');
  });

  it('keeps payroll where the shell already lists it', () => {
    expect(DESTINATIONS.map((destination) => destination.href)).toContain('/payroll');
  });

  /** The rule the authorization stated first: this slice writes nothing. */
  it('introduces no write anywhere in its routes or its composition', () => {
    const sources = [
      '../app/payroll/page.tsx',
      '../app/payroll/runs/[payrollRunId]/page.tsx',
      '../app/payroll/results/[payrollResultId]/page.tsx',
      './api.ts',
      './workspace.tsx',
      './configuration.tsx',
      './run.tsx',
      './results.tsx',
      './outputs.tsx',
      './payslip.tsx',
    ].map((path) =>
      readFileSync(new URL(path, import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, ''),
    );

    for (const source of sources) {
      expect(source).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/);
      expect(source).not.toMatch(/<form|<button|<input\b|<select\b|<textarea/);
      expect(source).not.toMatch(/'use client'/);
    }
  });
});
