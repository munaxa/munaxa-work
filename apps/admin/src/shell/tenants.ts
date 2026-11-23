import { apiOutcome, type ApiOutcome } from './api-request';
import { isTenantId } from './session-continuity';

/** `GET /api/v1/session/tenants`, as the API publishes it. */
interface SessionTenants {
  readonly tenants: readonly { readonly tenantId: string }[];
}

const tenantIdOf = (entry: unknown): string | undefined => {
  if (typeof entry !== 'object' || entry === null || !('tenantId' in entry)) return undefined;
  return typeof entry.tenantId === 'string' ? entry.tenantId : undefined;
};

/**
 * The tenants the signed-in caller may act in, as the API answers for their own credential.
 *
 * The list the picker offers and the list a choice is checked against before it is remembered.
 * Anything that is not a tenant identifier is dropped rather than rendered.
 */
export const memberTenants = async (): Promise<ApiOutcome<readonly string[]>> => {
  const answer = await apiOutcome<SessionTenants>('/session/tenants');
  if (answer.kind !== 'ok') return answer;

  const listed: readonly unknown[] = Array.isArray(answer.value.tenants)
    ? answer.value.tenants
    : [];
  return {
    kind: 'ok',
    value: listed.map(tenantIdOf).filter(isTenantId),
  };
};
