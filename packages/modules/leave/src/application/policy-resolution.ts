import { evaluateRule, type Facts, type Transaction } from '@work/kernel';

import { accept, refuse, type LeaveResult } from '../domain/leave-rejection.js';
import { coversDate, specificityOf } from '../domain/policy-assignment.js';
import type { LeavePolicyState } from '../domain/leave-policy.js';
import type { PolicyAssignmentState } from '../domain/policy-assignment.js';
import type { EmploymentForLeave } from './leave-ports.js';
import type { LeaveDependencies } from './leave-dependencies.js';

/**
 * Which policy version governs an employment for a leave type, as at a date.
 *
 * **Most-specific-wins**, and the winner is *recorded on the request* rather than re-resolved
 * later: an assignment ended in June must not change what a request approved in March was decided
 * under. This is the same discipline every effective-dated resolution in this product follows, and
 * the reason the request carries `leavePolicyId` rather than `leaveTypeId` alone.
 *
 * **Ties are refused, never broken.** Two assignments claiming the same unit on the same date is a
 * configuration mistake with no correct answer; picking one silently would give somebody an
 * entitlement nobody chose, and they would never find out which policy produced their figure.
 *
 * The scopes an employment belongs to come from **Employment**, through the directory port — its
 * unit and its legal entity as at the date. Leave does not read Organization's tables to work out
 * where somebody sits, and it does not cache the answer.
 */

export interface ResolvedPolicy {
  readonly policy: LeavePolicyState;
  readonly assignment: PolicyAssignmentState;
}

export const resolvePolicy = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  request: {
    readonly employment: EmploymentForLeave;
    readonly leaveTypeId: string;
    readonly onDate: string;
  },
): Promise<LeaveResult<ResolvedPolicy>> => {
  const scopeIds = scopesOf(request.employment);
  const candidates = await dependencies.stores.assignments.candidates(
    transaction,
    scopeIds,
    request.onDate,
  );
  const applicable = candidates.filter((one) => coversDate(one, request.onDate));

  if (applicable.length === 0) return refuse('no_policy_assigned');

  const policies = await policiesFor(transaction, dependencies, applicable, request.leaveTypeId);
  const matched = applicable.filter((one) => policies.has(one.leavePolicyId));

  if (matched.length === 0) return refuse('no_policy_assigned');

  return mostSpecific(matched, policies);
};

/**
 * The identifiers an assignment may be scoped to for this employment.
 *
 * The tenant scope has no identifier, so it is represented by the sentinel the store understands:
 * a `tenant`-scoped assignment matches everybody. The unit and the legal entity come from
 * Employment's answer as at the date, which is why the caller resolves the employment first.
 */
const scopesOf = (employment: EmploymentForLeave): readonly string[] =>
  [employment.employmentId, employment.unitId, employment.legalEntityId].filter(
    (one): one is string => one !== undefined,
  );

const policiesFor = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  assignments: readonly PolicyAssignmentState[],
  leaveTypeId: string,
): Promise<ReadonlyMap<string, LeavePolicyState>> => {
  const found = new Map<string, LeavePolicyState>();

  for (const assignment of assignments) {
    const policy = await dependencies.stores.policies.byId(transaction, assignment.leavePolicyId);

    // Only a **published** version governs anybody. A draft assigned by mistake is invisible here
    // rather than quietly binding, which is the whole point of publication being a separate act.
    if (policy === undefined || policy.status !== 'published') continue;
    if (policy.leaveTypeId !== leaveTypeId) continue;

    found.set(policy.id, policy);
  }
  return found;
};

const mostSpecific = (
  assignments: readonly PolicyAssignmentState[],
  policies: ReadonlyMap<string, LeavePolicyState>,
): LeaveResult<ResolvedPolicy> => {
  const ranked = [...assignments].sort(
    (one, other) => specificityOf(other.scope) - specificityOf(one.scope),
  );
  const [best, next] = ranked;

  if (best === undefined) return refuse('no_policy_assigned');
  if (next !== undefined && specificityOf(next.scope) === specificityOf(best.scope)) {
    return refuse('policy_assignments_conflict', { scope: best.scope });
  }

  const policy = policies.get(best.leavePolicyId);

  if (policy === undefined) return refuse('no_policy_assigned');

  return accept({ policy, assignment: best });
};

/**
 * Whether the policy's eligibility rule is satisfied, with its trace kept for the refusal.
 *
 * Evaluated through the kernel engine rather than interpreted here: the engine is deterministic,
 * total (a missing fact is an explicit outcome rather than a silent false), sandboxed — a tenant's
 * rule is data and cannot execute — and self-explaining, which is what makes a refused request
 * answerable. A policy with no rule is satisfied by definition.
 */
export const ruleSatisfiedBy = (policy: LeavePolicyState, facts: Facts): boolean => {
  if (policy.eligibilityRule === undefined) return true;

  const evaluation = evaluateRule(policy.eligibilityRule, facts);

  // A rule that could not be evaluated — a fact the tenant's rule names and the request does not
  // supply — is **not** treated as satisfied. Failing open here would grant leave on the strength
  // of a configuration mistake.
  return evaluation.ok && evaluation.value.matched;
};
