import { err, ok, type HandlerFailure, type Result, type Transaction } from '@work/kernel';

import { Employment, type EmploymentState } from '../domain/employment.js';
import { acceptsAmendment } from '../domain/employment-vocabulary.js';

import type { EmploymentDependencies } from './employment-dependencies.js';
import type { EmploymentStores } from './employment-ports.js';

/**
 * Loading the employment a command is about, with the two checks every write needs.
 *
 * **It exists in this tenant.** The store filters by tenant and row-level security refuses the
 * query underneath it, so an identifier from another customer answers *not found* rather than
 * *forbidden* — a caller has no business learning that an identifier names a real employment here.
 *
 * **It still accepts changes.** An ended employment is the record of what happened; writing a new
 * assignment onto one would put the change on a record every later module treats as closed, which
 * is worse than a refusal because it looks like it worked.
 *
 * Written once because it precedes every command in the module, and a check that has to be
 * remembered in a dozen handlers is a check that will be missing from one.
 */
export const loadWritableEmployment = async (
  transaction: Transaction,
  stores: EmploymentStores,
  employmentId: string,
): Promise<Result<EmploymentState, HandlerFailure>> => {
  const state = await stores.employments.byId(transaction, employmentId);

  if (state === undefined) return err({ kind: 'not_found', resource: 'employment' });
  if (!acceptsAmendment(state.status)) {
    return err({ kind: 'rejected', reason: 'employment.rejection.employment_ended' });
  }
  return ok(state);
};

/** The same, without the writability check: an ended employment is still fully readable. */
export const loadEmployment = async (
  transaction: Transaction,
  stores: EmploymentStores,
  employmentId: string,
): Promise<Result<EmploymentState, HandlerFailure>> => {
  const state = await stores.employments.byId(transaction, employmentId);

  if (state === undefined) return err({ kind: 'not_found', resource: 'employment' });
  return ok(state);
};

/** Rehydrates the aggregate from state a guard already fetched. */
export const employmentFrom = (state: EmploymentState): Employment => Employment.rehydrate(state);

/**
 * Checks that the person an employment is about is one this tenant may employ.
 *
 * Two refusals, and the second is the one Phase 4 asked this phase to make.
 *
 * A person who **does not resolve** is either absent or in another tenant, and both answer the
 * same way. A person who has been **merged into another record** is the interesting case: Phase 4
 * merges by redirection rather than consolidation, so the losing record survives and still reads.
 * Creating an employment against it would attach somebody's job to a record every future lookup
 * redirects away from — the employment would exist and effectively belong to nobody. The refusal
 * names the survivor so the caller can retry against the right person rather than guess.
 */
export const checkEmployablePerson = async (
  dependencies: EmploymentDependencies,
  personId: string,
  asOf: Date,
): Promise<Result<string, HandlerFailure>> => {
  const person = await dependencies.people.find(personId, asOf);

  if (person === undefined) return err({ kind: 'not_found', resource: 'person' });
  if (person.mergedIntoPersonId !== undefined) {
    return err({ kind: 'rejected', reason: 'employment.rejection.person_merged' });
  }
  return ok(person.personId);
};

/**
 * Checks that an organizational unit is real in this tenant.
 *
 * Only the unit is checked, and the gap is deliberate rather than forgotten: Organization
 * publishes no single-entity read for a position or a cost centre, and Employment neither reaches
 * into its tables nor reshapes its schema to compensate (ADR-0042). Those references rest on
 * row-level security, which makes another tenant's row unreadable.
 */
export const checkUnit = async (
  dependencies: EmploymentDependencies,
  unitId: string,
  asOf: Date,
): Promise<Result<string, HandlerFailure>> => {
  const exists = await dependencies.organization.unitExists(unitId, asOf);

  if (!exists) return err({ kind: 'not_found', resource: 'organization unit' });
  return ok(unitId);
};
