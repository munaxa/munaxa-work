import { describe, expect, it, vi } from 'vitest';

import { requestKindOf } from './entitlement.guard.js';
import { HourlyHeadcountReporter } from './usage.reporter.js';

const settings = { url: 'https://control.munaxa.test', token: 'mxc_secret' };
const TENANT = '01920000-0000-7000-8000-00000000aaaa';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the hourly headcount report', () => {
  it('reports once per tenant per hour, stamped with the hour, with the credential', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve({ ok: true, status: 200 });
    }) as unknown as typeof fetch;
    const reporter = new HourlyHeadcountReporter(settings, () => Promise.resolve(41), fetchImpl);

    reporter.noteActivity(TENANT, new Date('2026-10-27T09:05:00Z'));
    reporter.noteActivity(TENANT, new Date('2026-10-27T09:55:00Z'));
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://control.munaxa.test/api/v1/products/work/usage');
    expect(calls[0]?.init.headers).toMatchObject({ authorization: 'Bearer mxc_secret' });
    expect(calls[0]?.init.redirect).toBe('error');
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      reports: [
        {
          tenantId: TENANT,
          metric: 'employees',
          value: 41,
          measuredAt: '2026-10-27T09:00:00.000Z',
        },
      ],
    });

    reporter.noteActivity(TENANT, new Date('2026-10-27T10:01:00Z'));
    await flush();
    expect(calls).toHaveLength(2);
  });

  it('tries again on the next operation after a failure, and never throws', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValue({ ok: true, status: 200 });
    const reporter = new HourlyHeadcountReporter(settings, () => Promise.resolve(3), fetchImpl);
    const at = new Date('2026-10-27T09:05:00Z');
    expect(() => {
      reporter.noteActivity(TENANT, at);
    }).not.toThrow();
    await flush();
    await flush();
    reporter.noteActivity(TENANT, at);
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('the request kind', () => {
  it('reads a module export as an export, and nothing else', () => {
    expect(requestKindOf('GET', '/api/v1/people/export')).toBe('EXPORT');
    expect(requestKindOf('GET', '/api/v1/employment/export/')).toBe('EXPORT');
    expect(requestKindOf('GET', '/api/v1/people/exporter')).toBe('READ');
    expect(requestKindOf('POST', '/api/v1/people/export')).toBe('WRITE');
  });
});
