import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  loadApplication,
  loadApplicationDetail,
  loadHiring,
  loadRequisition,
  loadRequisitionDetail,
} from './api';
import { anApplicationSnapshot, aRequisitionSnapshot } from './hiring.fixture';

/**
 * What the hiring screens ask for, and what they do when they get no answer.
 *
 * **Behavioural** — refused and empty must survive the round trip as different values, because the
 * screens render them as opposite sentences. In this deployment refused is the ordinary case: the
 * pipeline checks the permission before the handler runs, and no request carries a principal.
 *
 * **Structural** — read against the source, because two of the properties are about what this file
 * is *allowed to send*. A composed request that named a caller would let anybody holding the
 * permission read as somebody else, and a request issued per row would be an unbounded read on a
 * page of four hundred applicants; neither would show up in any rendered output.
 */

const SOURCE = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');

/**
 * Every path this file constructs, and nothing else.
 *
 * The assertions below are about the *requests*, so they read the request literals rather than the
 * whole file: prose explaining why an application carries no candidate name would otherwise fail a
 * test looking for the word "candidate" in a URL.
 */
const REQUESTS = [...SOURCE.matchAll(/read<[^(]*\(\s*`([^`]*)`/g)].map((match) => match[1] ?? '');

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const refused = (): Response => new Response('', { status: 403 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what the hiring screens are allowed to ask for', () => {
  it('constructs the requests this slice was authorized to make, and no others', () => {
    expect(REQUESTS).toEqual([
      '/recruitment/vacancies/${vacancy.vacancyId}/pipeline',
      '/recruitment/requisitions?${PAGE}',
      '/recruitment/vacancies?${PAGE}',
      '/recruitment/candidates?${PAGE}',
      '/recruitment/applications?${PAGE}',
      '/recruitment/requisitions/${requisitionId}',
      '/employments/${requisition.requestedByEmploymentId}',
      '/employments/${requisition.hiringManagerEmploymentId}',
      '/recruitment/applications/${applicationId}',
      '/recruitment/candidates/${snapshot.application.candidateId}',
      '/recruitment/interviews/${interview.interviewId}/feedback',
    ]);
  });

  /**
   * The property that stops a screen reading as somebody else.
   *
   * Every interpolation is an identifier the route was given or a value the API itself returned.
   * None is a membership, a workforce user, a principal or a `me`, and there is no parameter here
   * that could carry one.
   */
  it('names no caller and offers no way to supply one', () => {
    for (const request of REQUESTS) {
      expect(request).not.toMatch(
        /membership|workforceUser|principal|actor|onBehalf|\bme\b|viewAs/i,
      );
    }
  });

  it('pages every listing explicitly rather than trusting a default', () => {
    const listings = REQUESTS.filter((request) => request.endsWith('${PAGE}'));

    expect(listings).toHaveLength(4);
    expect(SOURCE).toContain("const PAGE = 'page=1&size=25'");
  });

  it('writes nothing: no method, body or mutating verb is composed anywhere', () => {
    expect(SOURCE).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/);
    expect(SOURCE).not.toMatch(/\bbody:\s/);
  });
});

describe('reading the workspace', () => {
  it('reports a refusal as absent, not as an empty workspace', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(refused()));

    const hiring = await loadHiring();

    expect(hiring.requisitions).toBeUndefined();
    expect(hiring.vacancies).toBeUndefined();
    expect(hiring.candidates).toBeUndefined();
    expect(hiring.applications).toBeUndefined();
    expect(hiring.pipelines).toBeUndefined();
  });

  it('reports an empty answer as an empty listing, not as a refusal', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(json({ items: [], total: 0 })));

    const hiring = await loadHiring();

    expect(hiring.requisitions).toEqual({ items: [], total: 0 });
    expect(hiring.pipelines).toEqual([]);
  });

  it('keeps the server total rather than the page length', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(json({ items: [{ requisitionId: 'r1' }], total: 412 })),
    );

    const hiring = await loadHiring();

    expect(hiring.requisitions?.total).toBe(412);
    expect(hiring.requisitions?.items).toHaveLength(1);
  });

  it('shows the half a caller may read when the other half is refused', async () => {
    vi.stubGlobal('fetch', (input: string) =>
      Promise.resolve(
        input.includes('/candidates') ? refused() : json({ items: [{ id: 'x' }], total: 3 }),
      ),
    );

    const hiring = await loadHiring();

    expect(hiring.candidates).toBeUndefined();
    expect(hiring.requisitions?.total).toBe(3);
  });

  it('reads one pipeline per vacancy the server returned, and none for a refused listing', async () => {
    const seen: string[] = [];

    vi.stubGlobal('fetch', (input: string) => {
      seen.push(input);
      return Promise.resolve(json({ items: [{ vacancyId: 'v1' }, { vacancyId: 'v2' }], total: 9 }));
    });

    await loadHiring();

    expect(seen.filter((path) => path.endsWith('/pipeline'))).toHaveLength(2);
  });

  /** A refused pipeline is not an empty one: a vacancy nobody may count is not a vacancy with nobody in it. */
  it('keeps a refused pipeline apart from an empty one', async () => {
    vi.stubGlobal('fetch', (input: string) =>
      Promise.resolve(
        input.endsWith('/pipeline') ? refused() : json({ items: [{ vacancyId: 'v1' }], total: 1 }),
      ),
    );

    const hiring = await loadHiring();

    expect(hiring.pipelines?.[0]?.pipeline).toBeUndefined();
  });
});

describe('reading one requisition', () => {
  it('answers a refusal with nothing, so the route can render not-found rather than a page of refusals', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 404 })));

    expect(await loadRequisition('r1')).toBeUndefined();
  });

  it('resolves the requester by employment and leaves an absent hiring manager unasked', async () => {
    const seen: string[] = [];

    vi.stubGlobal('fetch', (input: string) => {
      seen.push(input);
      return Promise.resolve(json({ personName: { en: 'Nadia', ar: 'نادية' } }));
    });

    const snapshot = aRequisitionSnapshot();
    // `exactOptionalPropertyTypes` is on, so an absent hiring manager is an absent *key* rather than
    // an explicit `undefined` — which is the distinction the composition is being asked about.
    const { hiringManagerEmploymentId: _named, ...requisition } = snapshot.requisition;
    const detail = await loadRequisitionDetail({ ...snapshot, requisition });

    expect(detail.requestedByName).toEqual({ en: 'Nadia', ar: 'نادية' });
    expect(detail.hiringManagerName).toBeUndefined();
    expect(seen.filter((path) => path.includes('/employments/'))).toHaveLength(1);
  });
});

describe('reading one application', () => {
  it('answers a refusal with nothing', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(refused()));

    expect(await loadApplication('a1')).toBeUndefined();
  });

  /**
   * The snapshot is one read and this file does not take it apart.
   *
   * History, interviews and offers arrive together so a screen cannot show an interview from one
   * state beside a status from another; re-asking for any of them would reintroduce exactly that.
   */
  it('re-reads nothing the snapshot already carries', async () => {
    const seen: string[] = [];

    vi.stubGlobal('fetch', (input: string) => {
      seen.push(input);
      return Promise.resolve(json([]));
    });

    await loadApplicationDetail(anApplicationSnapshot());

    expect(seen.some((path) => path.includes('/interviews?'))).toBe(false);
    expect(seen.some((path) => path.includes('/history'))).toBe(false);
    expect(seen.some((path) => path.includes('/offers'))).toBe(false);
  });

  it('reads the candidate once and the panel once per interview on this application', async () => {
    const seen: string[] = [];

    vi.stubGlobal('fetch', (input: string) => {
      seen.push(input);
      return Promise.resolve(json([]));
    });

    await loadApplicationDetail(anApplicationSnapshot());

    expect(seen.filter((path) => path.includes('/recruitment/candidates/'))).toHaveLength(1);
    expect(seen.filter((path) => path.endsWith('/feedback'))).toHaveLength(1);
  });

  it('keeps a refused panel apart from a panel that recorded nothing', async () => {
    vi.stubGlobal('fetch', (input: string) =>
      Promise.resolve(input.endsWith('/feedback') ? refused() : json({ candidate: {} })),
    );

    const withheld = await loadApplicationDetail(anApplicationSnapshot());

    expect(withheld.panels[0]?.feedback).toBeUndefined();

    vi.stubGlobal('fetch', () => Promise.resolve(json([])));

    const empty = await loadApplicationDetail(anApplicationSnapshot());

    expect(empty.panels[0]?.feedback).toEqual([]);
  });

  it('keeps a refused candidate apart from an application that reads', async () => {
    vi.stubGlobal('fetch', (input: string) =>
      Promise.resolve(input.includes('/candidates/') ? refused() : json([])),
    );

    const detail = await loadApplicationDetail(anApplicationSnapshot());

    expect(detail.candidate).toBeUndefined();
    expect(detail.snapshot.application.applicationNumber).toBe('APP-009913');
  });
});
