'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  PORTAL_COOKIE,
  TENANT_PAGE,
  TENANT_SELECTION_COOKIE,
  TENANT_SELECTION_SECONDS,
  chosenTenant,
  safeReturnTo,
} from './session-continuity';
import { memberTenants } from './tenants';

const field = (form: FormData, name: string): string | undefined => {
  const value = form.get(name);
  return typeof value === 'string' ? value : undefined;
};

/**
 * Remembers the tenant the person chose, after checking it is one of theirs (MW-007).
 *
 * The check is made here, on the server, against the list the API returns for the caller's own
 * credential at the moment of choosing. A value the browser made up, or a tenant the person no
 * longer belongs to, is never written: the selection is forgotten instead and the picker is shown
 * again. The cookie is `HttpOnly`, `Secure`, `SameSite=Lax` and `Path=/`.
 *
 * Remembering a tenant still grants nothing. The API re-resolves the caller's memberships on every
 * request and uses this only to choose among them.
 */
export async function selectTenant(form: FormData): Promise<void> {
  const listed = await memberTenants();
  const tenant =
    listed.kind === 'ok' ? chosenTenant(field(form, 'tenantId'), listed.value) : undefined;
  const jar = await cookies();

  if (tenant === undefined) {
    jar.delete(TENANT_SELECTION_COOKIE);
    redirect(TENANT_PAGE);
  }
  jar.set(TENANT_SELECTION_COOKIE, tenant, { ...PORTAL_COOKIE, maxAge: TENANT_SELECTION_SECONDS });
  redirect(safeReturnTo(field(form, 'returnTo')));
}

/** Forgets the choice, so the API resolves a single membership by itself again. */
export async function forgetTenant(form: FormData): Promise<void> {
  (await cookies()).delete(TENANT_SELECTION_COOKIE);
  redirect(safeReturnTo(field(form, 'returnTo')));
}
