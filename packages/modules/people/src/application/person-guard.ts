import { err, ok, type HandlerFailure, type Result, type Transaction } from '@work/kernel';

import { Person, type PersonState } from '../domain/person.js';
import { acceptsAmendment } from '../domain/people-vocabulary.js';

import type { PeopleStores } from './people-ports.js';

/**
 * Loading the person a command is about, with the two checks every write needs.
 *
 * **The person exists in this tenant.** The store filters by tenant and row-level security refuses
 * the query underneath it, so an identifier from another customer answers *not found* rather than
 * *forbidden* — a caller has no business learning that an identifier names a real person here.
 *
 * **The person still accepts changes.** A merged record redirects to another; writing a new
 * address onto it would put the change on a record nothing reads, which is worse than a refusal
 * because it looks like it worked.
 *
 * Written once because it precedes every command in the module, and a check that has to be
 * remembered in fourteen handlers is a check that will be missing from one.
 */
export const loadWritablePerson = async (
  transaction: Transaction,
  stores: PeopleStores,
  personId: string,
): Promise<Result<PersonState, HandlerFailure>> => {
  const state = await stores.people.byId(transaction, personId);

  if (state === undefined) return err({ kind: 'not_found', resource: 'person' });
  if (!acceptsAmendment(state.status)) {
    return err({ kind: 'rejected', reason: 'people.rejection.person_merged' });
  }
  return ok(state);
};

/** The same, without the writability check: a merged person is still fully readable (AD-009). */
export const loadPerson = async (
  transaction: Transaction,
  stores: PeopleStores,
  personId: string,
): Promise<Result<PersonState, HandlerFailure>> => {
  const state = await stores.people.byId(transaction, personId);

  if (state === undefined) return err({ kind: 'not_found', resource: 'person' });
  return ok(state);
};

/** Rehydrates the aggregate from state a guard already fetched. */
export const personFrom = (state: PersonState): Person => Person.rehydrate(state);
