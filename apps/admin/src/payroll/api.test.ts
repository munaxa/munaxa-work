import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadPayrollWorkspace, loadPayslip, loadRun, loadRunDetail } from './api';
import { aRun } from './payroll.fixture';

/**
 * What the payroll screens ask for, and what they do when they get no answer.
 *
 * **Behavioural** — refused and empty must survive the round trip as different values, because the
 * screens render them as opposite sentences, and on a payroll screen "no results" against a run
 * whose own `resultCount` says 1,398 is the most misleading thing the product could print.
 *
 * **Structural** — read against the source, because two properties are about what this file is
 * *allowed to send* and one is about what it must never take. A request naming a caller would let
 * anybody holding the permission read as somebody else; and a composition that indexed a page would
 * reintroduce the `runs[0]` defect this slice exists to remove — neither shows up in rendered output.
 */

const SOURCE = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');

/**
 * The same file with its prose removed.
 *
 * The structural assertions below are about what the *code* does, and the comments in that file
 * explain the very defect being asserted against — a scan for `runs[0]` otherwise fails on the
 * sentence saying `runs[0]` is what this composition no longer does.
 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** Every path this file constructs, and nothing else. */
const REQUESTS = [...SOURCE.matchAll(/read<[^(]*\(\s*[`']([^`']*)[`']/g)].map(
  (match) => match[1] ?? '',
);

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const refused = (): Response => new Response('', { status: 403 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what the payroll screens are allowed to ask for', () => {
  it('constructs the requests this slice was authorized to make, and no others', () => {
    expect(REQUESTS).toEqual([
      '/dashboard',
      '/runs?${PAGE}',
      '/periods?${PAGE}',
      '/groups',
      '/deduction-definitions?payrollGroupId=${first.payrollGroupId}',
      '/runs/${payrollRunId}',
      '/runs/${id}/results?${PAGE}',
      '/runs/${id}/exceptions',
      '/runs/${id}/adjustments',
      '/runs/${id}/approval-chain',
      '/runs/${id}/reconciliation',
      '/runs/${id}/accounting-output?${PAGE}',
      '/runs/${id}/payment-instructions?${PAGE}',
      '/results/${payrollResultId}/payslip',
    ]);
  });

  it('names no caller and offers no way to supply one', () => {
    for (const request of REQUESTS) {
      expect(request).not.toMatch(
        /membership|workforceUser|principal|actor|onBehalf|\bme\b|viewAs/i,
      );
    }
  });

  /**
   * The defect this slice exists to remove.
   *
   * The previous composition read a page of runs and described `runs[0]` as though it were the run,
   * and did the same with `results.items[0]`. Neither a run nor a result is ever reached by index
   * here: both come from a bounded read keyed on an identifier the route was given.
   */
  it('indexes no page: no run or result is reached by position', () => {
    expect(CODE).not.toMatch(/runs\s*\[\s*0\s*\]/);
    expect(CODE).not.toMatch(/results[^\n]*\.items\s*\[\s*0\s*\]/);
    expect(CODE).toContain('/runs/${payrollRunId}');
    expect(CODE).toContain('/results/${payrollResultId}/payslip');
  });

  it('writes nothing: no method, body or mutating verb is composed anywhere', () => {
    expect(CODE).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/);
    expect(CODE).not.toMatch(/\bbody:\s/);
  });

  it('pages every paged listing explicitly rather than trusting a default', () => {
    expect(SOURCE).toContain("const PAGE = 'page=1&size=50'");
    expect(REQUESTS.filter((request) => request.includes('${PAGE}'))).toHaveLength(5);
  });
});

describe('reading the workspace', () => {
  it('reports a refusal as absent, not as an empty workspace', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(refused()));

    const workspace = await loadPayrollWorkspace();

    expect(workspace.dashboard).toBeUndefined();
    expect(workspace.runs).toBeUndefined();
    expect(workspace.periods).toBeUndefined();
    expect(workspace.groups).toBeUndefined();
  });

  it('reports an empty answer as an empty listing, not as a refusal', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(json({ items: [], total: 0 })));

    const workspace = await loadPayrollWorkspace();

    expect(workspace.runs).toEqual({ items: [], total: 0 });
    expect(workspace.groups).toEqual([]);
  });

  it('keeps the server total rather than the page length', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(json({ items: [{ payrollRunId: 'r1' }], total: 412 })),
    );

    const workspace = await loadPayrollWorkspace();

    expect(workspace.runs?.total).toBe(412);
    expect(workspace.runs?.items).toHaveLength(1);
  });

  /** Deduction definitions are scoped to a group, so no group means no request rather than a guess. */
  it('asks for no deduction definitions when no group answered', async () => {
    const seen: string[] = [];

    vi.stubGlobal('fetch', (input: string) => {
      seen.push(input);
      return Promise.resolve(json({ items: [], total: 0 }));
    });

    const workspace = await loadPayrollWorkspace();

    expect(seen.some((path) => path.includes('/deduction-definitions'))).toBe(false);
    expect(workspace.definitionsGroup).toBeUndefined();
  });
});

describe('reading one run', () => {
  it('answers a refusal with nothing, so the route renders not-found rather than a page of refusals', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 404 })));

    expect(await loadRun('n1')).toBeUndefined();
  });

  /**
   * Payroll separates four permissions and this keeps four answers apart.
   *
   * A caller may read the run and be refused what anybody was paid, the journal and the payment
   * instructions — three different refusals under three different permissions.
   */
  it('keeps a refused figure, journal and instruction apart from an empty one', async () => {
    vi.stubGlobal('fetch', (input: string) =>
      Promise.resolve(
        /results|accounting-output|payment-instructions/.test(input)
          ? refused()
          : json({ items: [{ id: 'x' }], total: 3 }),
      ),
    );

    const detail = await loadRunDetail(aRun());

    expect(detail.results).toBeUndefined();
    expect(detail.accounting).toBeUndefined();
    expect(detail.payments).toBeUndefined();
    expect(detail.exceptions).toEqual([{ id: 'x' }]);
  });

  it('reads each part of the run exactly once', async () => {
    const seen: string[] = [];

    vi.stubGlobal('fetch', (input: string) => {
      seen.push(input);
      return Promise.resolve(json({ items: [], total: 0 }));
    });

    await loadRunDetail(aRun());

    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });
});

describe('reading one result', () => {
  it('answers a refusal with nothing', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(refused()));

    expect(await loadPayslip('t1')).toBeUndefined();
  });

  /**
   * The payslip carries both line sets, so nothing asks for earnings or deductions separately —
   * the module returns them together precisely so one line set cannot come from another state.
   */
  it('re-reads nothing the payslip already carries', async () => {
    const seen: string[] = [];

    vi.stubGlobal('fetch', (input: string) => {
      seen.push(input);
      return Promise.resolve(json({ earnings: [], deductions: [] }));
    });

    await loadPayslip('t1');

    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('/results/t1/payslip');
  });
});
