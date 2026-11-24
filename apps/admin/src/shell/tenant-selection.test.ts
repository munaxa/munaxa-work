import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The tenant picker's server action (MW-007): a choice is remembered only after the server has
 * checked it against the tenants the API lists for the caller's own credential.
 */

interface Written {
  readonly value: string;
  readonly options: Record<string, unknown>;
}

const jar = new Map<string, string>();
const written = new Map<string, Written>();
const deleted: string[] = [];

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = jar.get(name);
        return value === undefined ? undefined : { value };
      },
      set: (name: string, value: string, options: Record<string, unknown>) => {
        written.set(name, { value, options });
      },
      delete: (name: string) => {
        deleted.push(name);
      },
    }),
}));

/** Next's `redirect` throws to end the action; the test records where it would have gone. */
class Redirected extends Error {
  public constructor(public readonly location: string) {
    super(location);
  }
}

vi.mock('next/navigation', () => ({
  redirect: (location: string): never => {
    throw new Redirected(location);
  },
}));

vi.mock('@work/config', () => ({
  loadPortalProcessEnvironment: (): { WORK_API_URL: string } => ({
    WORK_API_URL: 'http://api.test',
  }),
}));

const { selectTenant, forgetTenant } = await import('./tenant-selection.js');

const A = '01920000-0000-7000-8000-0000000000aa';
const B = '01920000-0000-7000-8000-0000000000bb';

const listing = (status: number, tenants: readonly string[] = []): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      expect(url).toBe('http://api.test/api/v1/session/tenants');
      return Promise.resolve({
        ok: status === 200,
        status,
        json: () => Promise.resolve({ tenants: tenants.map((tenantId) => ({ tenantId })) }),
        text: () => Promise.resolve(''),
      });
    }),
  );
};

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

const destinationOf = async (action: Promise<void>): Promise<string> => {
  try {
    await action;
  } catch (error) {
    if (error instanceof Redirected) return error.location;
    throw error;
  }
  throw new Error('The action did not redirect.');
};

beforeEach(() => {
  jar.clear();
  written.clear();
  deleted.length = 0;
  jar.set('__Host-mx_session', 'a-platform-access-token');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('choosing a tenant', () => {
  it('remembers a tenant the API lists for the caller, with the cookie attributes required', async () => {
    listing(200, [A, B]);

    const location = await destinationOf(
      selectTenant(form({ tenantId: B, returnTo: '/payroll?lang=ar' })),
    );

    expect(location).toBe('/payroll?lang=ar');
    expect(written.get('munaxa_work_tenant')).toEqual({
      value: B,
      options: expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
      }) as Record<string, unknown>,
    });
  });

  it('refuses a tenant the caller does not belong to, and forgets the old choice', async () => {
    listing(200, [A]);

    const location = await destinationOf(selectTenant(form({ tenantId: B, returnTo: '/payroll' })));

    expect(location).toBe('/session/tenant');
    expect(written.size).toBe(0);
    expect(deleted).toEqual(['munaxa_work_tenant']);
  });

  it('remembers nothing when the list cannot be read', async () => {
    listing(503);

    await destinationOf(selectTenant(form({ tenantId: A })));

    expect(written.size).toBe(0);
  });

  it('never returns to another origin', async () => {
    listing(200, [A]);

    const location = await destinationOf(
      selectTenant(form({ tenantId: A, returnTo: 'https://evil.example/' })),
    );

    expect(location).toBe('/');
  });

  it('forgets the choice on request', async () => {
    const location = await destinationOf(forgetTenant(form({ returnTo: '/people' })));

    expect([location, deleted]).toEqual(['/people', ['munaxa_work_tenant']]);
  });
});
