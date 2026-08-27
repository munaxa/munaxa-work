import { readFileSync } from 'node:fs';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import hiringPage from '../app/recruitment/page';
import hiringLoading from '../app/recruitment/loading';
import requisitionPage from '../app/recruitment/requisitions/[requisitionId]/page';
import requisitionNotFound from '../app/recruitment/requisitions/[requisitionId]/not-found';
import applicationPage from '../app/recruitment/applications/[applicationId]/page';
import applicationNotFound from '../app/recruitment/applications/[applicationId]/not-found';
import { DESTINATIONS } from '../shell/navigation';

import { hiringTranslator } from './locale';
import {
  aCandidateSnapshot,
  aPanel,
  aPipeline,
  aRequisition,
  aRequisitionSnapshot,
  aVacancy,
  anApplication,
  anApplicationSnapshot,
  aCandidate,
} from './hiring.fixture';

/**
 * All three routes, end to end: a request in, Recruitment's answers, and the HTML a browser gets.
 *
 * The section suites prove each region renders what the module returned. Only this proves the routes
 * work — that the parameters are read, that the subject is resolved before anything else is asked,
 * that an unresolvable identifier is a 404 rather than a page of refusals, and that direction
 * follows language on the element wrapping all of it.
 */

const BASE = 'http://127.0.0.1:3000/api/v1';
const REQUISITION = '01900000-0000-7000-8000-0000000000r1';
const APPLICATION = '01900000-0000-7000-8000-0000000000a1';

const en = hiringTranslator('en');

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const ANSWERS: readonly (readonly [string, () => unknown])[] = [
  ['/recruitment/requisitions?', () => ({ items: [aRequisition()], total: 26 })],
  ['/recruitment/vacancies?', () => ({ items: [aVacancy()], total: 9 })],
  ['/recruitment/candidates?', () => ({ items: [aCandidate()], total: 412 })],
  ['/recruitment/applications?', () => ({ items: [anApplication()], total: 176 })],
  ['/pipeline', aPipeline],
  ['/feedback', aPanel],
  [`/recruitment/requisitions/${REQUISITION}`, aRequisitionSnapshot],
  [`/recruitment/applications/${APPLICATION}`, anApplicationSnapshot],
  ['/recruitment/candidates/', aCandidateSnapshot],
  ['/employments/', () => ({ personName: { en: 'Nadia Fakhoury', ar: 'نادية فاخوري' } })],
];

const answerEverything = (): void => {
  vi.stubGlobal('fetch', (input: string) => {
    const path = input.slice(BASE.length);
    const hit = ANSWERS.find(([fragment]) =>
      fragment.endsWith('?') || fragment.startsWith('/pipeline') || fragment.startsWith('/feedback')
        ? path.includes(fragment)
        : path.startsWith(fragment),
    );

    return Promise.resolve(hit === undefined ? new Response('', { status: 404 }) : json(hit[1]()));
  });
};

const refuseEverything = (): void => {
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 403 })));
};

const workspace = async (lang?: string): Promise<string> =>
  renderToStaticMarkup(
    (await hiringPage({
      searchParams: Promise.resolve(lang === undefined ? {} : { lang }),
    })) as ReactNode,
  );

const requisition = async (lang?: string): Promise<string> =>
  renderToStaticMarkup(
    (await requisitionPage({
      params: Promise.resolve({ requisitionId: REQUISITION }),
      searchParams: Promise.resolve(lang === undefined ? {} : { lang }),
    })) as ReactNode,
  );

const application = async (lang?: string): Promise<string> =>
  renderToStaticMarkup(
    (await applicationPage({
      params: Promise.resolve({ applicationId: APPLICATION }),
      searchParams: Promise.resolve(lang === undefined ? {} : { lang }),
    })) as ReactNode,
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the hiring workspace route', () => {
  it('puts the totals, the requisitions, the pipeline and the applications on one page', async () => {
    answerEverything();

    const markup = await workspace();

    expect(markup).toContain('REQ-000417');
    expect(markup).toContain('APP-009913');
    expect(markup).toContain('412');
    expect(markup).toContain('176');
    expect(markup).toContain(en('recruitment.label.pipeline'));
    expect(markup).toContain('dir="ltr"');
  });

  it('renders right to left in Arabic', async () => {
    answerEverything();

    const markup = await workspace('ar');

    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('lang="ar"');
    expect(markup).toContain('ممرض أول');
  });

  /**
   * The state of every deployment without Platform's authentication adapter.
   *
   * Nothing answered, so the screen says so once and invents no figure — never that hiring is empty.
   */
  it('says the refusal once, never that hiring is empty', async () => {
    refuseEverything();

    const markup = await workspace();

    expect(markup).toContain(en('recruitment.label.nothingReadable'));
    expect(markup).toContain(en('admin.notice.notSignedIn'));
    expect(markup).not.toContain(en('recruitment.label.noRequisitions'));
    expect(markup).not.toContain('412');
  });

  /** A section refused on its own still says so in its own place, beside the ones that answered. */
  it('says a single refused section was withheld while its neighbours render', async () => {
    vi.stubGlobal('fetch', (input: string) => {
      const path = input.slice(BASE.length);

      if (path.includes('/recruitment/candidates?'))
        return Promise.resolve(new Response('', { status: 403 }));

      const hit = ANSWERS.find(([fragment]) =>
        fragment.endsWith('?') ||
        fragment.startsWith('/pipeline') ||
        fragment.startsWith('/feedback')
          ? path.includes(fragment)
          : path.startsWith(fragment),
      );

      return Promise.resolve(
        hit === undefined ? new Response('', { status: 404 }) : json(hit[1]()),
      );
    });

    const markup = await workspace();

    expect(markup).toContain(en('admin.notice.sectionWithheld'));
    expect(markup).toContain('REQ-000417');
    expect(markup).not.toContain(en('recruitment.label.nothingReadable'));
  });
});

describe('the requisition route', () => {
  it('resolves the requisition first, then asks for the rest', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', (input: string) => {
      asked.push(input);
      const path = input.slice(BASE.length);
      const hit = ANSWERS.find(([fragment]) => path.includes(fragment));

      return Promise.resolve(
        hit === undefined ? new Response('', { status: 404 }) : json(hit[1]()),
      );
    });

    await requisition();

    expect(asked[0]).toBe(`${BASE}/recruitment/requisitions/${REQUISITION}`);
  });

  it('puts the headcount, the decisions and each vacancy pipeline on one page', async () => {
    answerEverything();

    const markup = await requisition();

    expect(markup).toContain(en('recruitment.label.remaining'));
    expect(markup).toContain(en('recruitment.status.decisionOutcome.reversed'));
    expect(markup).toContain('176');
    expect(markup).toContain('Nadia Fakhoury');
  });

  it('links back to hiring', async () => {
    answerEverything();

    expect(await requisition()).toContain('href="/recruitment?lang=en"');
  });

  it('answers not found rather than rendering a requisition nobody could read', async () => {
    refuseEverything();

    await expect(requisition()).rejects.toThrow();
  });

  it('asks for nothing else once the requisition refused', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', (input: string) => {
      asked.push(input);
      return Promise.resolve(new Response('', { status: 403 }));
    });

    await expect(requisition()).rejects.toThrow();
    expect(asked).toEqual([`${BASE}/recruitment/requisitions/${REQUISITION}`]);
  });

  it('renders a not-found page that says the API returned nothing, and offers a way back', () => {
    const markup = renderToStaticMarkup(requisitionNotFound());

    expect(markup).toContain(en('recruitment.label.requisitionNotFound'));
    expect(markup).toContain('href="/recruitment"');
  });
});

describe('the application route', () => {
  it('resolves the application first, then asks for the rest', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', (input: string) => {
      asked.push(input);
      const path = input.slice(BASE.length);
      const hit = ANSWERS.find(([fragment]) => path.includes(fragment));

      return Promise.resolve(
        hit === undefined ? new Response('', { status: 404 }) : json(hit[1]()),
      );
    });

    await application();

    expect(asked[0]).toBe(`${BASE}/recruitment/applications/${APPLICATION}`);
  });

  it('puts the candidate, the history, the panel and the offer on one page', async () => {
    answerEverything();

    const markup = await application();

    expect(markup).toContain('Layla Haddad');
    expect(markup).toContain(en('recruitment.label.panel'));
    expect(markup).toContain(en('recruitment.recommendation.strong_yes'));
    expect(markup).toContain('OFF-000221');
  });

  it('renders no offer figure end to end, though the API returned one', async () => {
    answerEverything();

    const markup = await application();

    expect(markup).not.toContain('1850');
    expect(markup).not.toContain('JOD');
  });

  it('answers not found rather than rendering an application nobody could read', async () => {
    refuseEverything();

    await expect(application()).rejects.toThrow();
  });

  it('renders a not-found page that says the API returned nothing, and offers a way back', () => {
    const markup = renderToStaticMarkup(applicationNotFound());

    expect(markup).toContain(en('recruitment.label.applicationNotFound'));
    expect(markup).toContain('href="/recruitment"');
  });
});

describe('the frame around all three', () => {
  it('renders a loading state that holds the layout and invents no figure', () => {
    const markup = renderToStaticMarkup(hiringLoading());

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('animate-pulse');

    // Nothing but shapes: the skeleton carries no text at all, so it can carry no placeholder
    // figure — a number on a hiring screen is one somebody might act on.
    expect(markup.replace(/<[^>]*>/g, '').trim()).toBe('');
  });

  it('keeps hiring where the shell already lists it', () => {
    expect(DESTINATIONS.map((destination) => destination.href)).toContain('/recruitment');
  });

  /**
   * The rule the authorization stated first: this slice writes nothing.
   *
   * Read against the route sources, because a form that posted would be a control this portal has
   * no principal for — it would answer 401 and look like a fault rather than a boundary.
   */
  it('introduces no write anywhere in its routes or its composition', () => {
    const sources = [
      '../app/recruitment/page.tsx',
      '../app/recruitment/requisitions/[requisitionId]/page.tsx',
      '../app/recruitment/applications/[applicationId]/page.tsx',
      './api.ts',
      './workspace.tsx',
      './pipeline.tsx',
      './requisition.tsx',
      './application.tsx',
      './panel.tsx',
    ].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'));

    for (const source of sources) {
      expect(source).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/);
      expect(source).not.toMatch(/<form|<button|<input\b|<select\b|<textarea/);
      expect(source).not.toMatch(/'use client'/);
    }
  });
});
