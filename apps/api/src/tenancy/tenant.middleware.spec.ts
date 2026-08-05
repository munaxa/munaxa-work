import type { Request, Response } from 'express';
import { currentContext, uuidV7 } from '@work/kernel';
import { describe, expect, it } from 'vitest';

import { TENANT_HEADER, TenantMiddleware } from './tenant.middleware.js';

const requestWith = (headers: Record<string, string>): Request =>
  ({ headers, correlationId: uuidV7() }) as unknown as Request;

const response = {} as Response;

describe('TenantMiddleware', () => {
  const middleware = new TenantMiddleware();

  it('establishes the tenant context for the rest of the request', () => {
    const tenantId = uuidV7();
    let observed: string | undefined;

    middleware.use(requestWith({ [TENANT_HEADER]: tenantId }), response, () => {
      const context = currentContext();
      observed = context !== undefined && !('system' in context) ? context.tenantId : undefined;
    });

    expect(observed).toBe(tenantId);
  });

  it('establishes no context when the tenant is absent, rather than defaulting to one', () => {
    let observed: unknown = 'unset';

    middleware.use(requestWith({}), response, () => {
      observed = currentContext();
    });

    expect(observed).toBeUndefined();
  });

  it('establishes no context when the tenant is malformed', () => {
    let observed: unknown = 'unset';

    middleware.use(requestWith({ [TENANT_HEADER]: 'not-a-tenant' }), response, () => {
      observed = currentContext();
    });

    expect(observed).toBeUndefined();
  });
});
