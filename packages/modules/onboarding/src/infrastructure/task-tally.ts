import type { Transaction } from '@work/kernel';

import type { TaskTally } from '../application/onboarding-ports.js';

/**
 * An onboarding's progress, counted in the database.
 *
 * Apart from the repository because it is two queries with five aggregate expressions, and a
 * repository's complexity budget is five — not because the counting is subtle. What *is* worth a
 * reviewer's attention is which rows each number includes.
 *
 * **Required and optional are counted separately, and completion depends only on the required
 * ones.** An onboarding whose optional "book a lunch with the team" was never done is complete; one
 * whose required right-to-work check was never done is not, and a single "12 of 15" would hide the
 * difference behind a percentage.
 *
 * **A cancelled task satisfies nothing and is outstanding no longer.** It leaves both the satisfied
 * count and the overdue count: a required task somebody cancelled did not happen, and reporting it
 * as overdue for ever would put a permanent red mark on a record nobody can clear.
 *
 * **Overdue takes the caller's date.** Not `current_date`: the store, the in-memory fake and the
 * test that asserts on them must agree about what day it is.
 */

interface TallyRow {
  readonly required_total: string;
  readonly required_satisfied: string;
  readonly required_overdue: string;
  readonly optional_total: string;
  readonly optional_satisfied: string;
}

interface OutstandingRow {
  readonly owner_kind: string;
  readonly outstanding: string;
}

const SATISFIED = `status in ('done', 'waived')`;
const OUTSTANDING = `status not in ('done', 'waived', 'cancelled')`;

const TALLY_SQL = `select
    count(*) filter (where required)::text as required_total,
    count(*) filter (where required and ${SATISFIED})::text as required_satisfied,
    count(*) filter (where required and ${OUTSTANDING}
      and due_on is not null and due_on < $3::date)::text as required_overdue,
    count(*) filter (where not required)::text as optional_total,
    count(*) filter (where not required and ${SATISFIED})::text as optional_satisfied
  from onboarding_task
  where tenant_id = $1 and onboarding_id = $2 and deleted_at is null`;

/**
 * What is still waiting, and on whom.
 *
 * By owner *kind* rather than by owner, so a screen can say "waiting on IT" and "waiting on the
 * joiner" without this query returning a row per employment — and without a progress summary
 * becoming a list of who is late.
 */
const OUTSTANDING_SQL = `select owner_kind, count(*)::text as outstanding
  from onboarding_task
  where tenant_id = $1 and onboarding_id = $2 and deleted_at is null and ${OUTSTANDING}
  group by owner_kind`;

const EMPTY: TallyRow = {
  required_total: '0',
  required_satisfied: '0',
  required_overdue: '0',
  optional_total: '0',
  optional_satisfied: '0',
};

export const tallyOf = async (
  transaction: Transaction,
  onboardingId: string,
  asOf: string,
): Promise<TaskTally> => {
  const parameters = [transaction.tenantId, onboardingId, asOf];
  const counted = await transaction.execute<TallyRow>(TALLY_SQL, parameters);
  const outstanding = await transaction.execute<OutstandingRow>(OUTSTANDING_SQL, [
    transaction.tenantId,
    onboardingId,
  ]);
  const row = counted[0] ?? EMPTY;

  return {
    requiredTotal: Number(row.required_total),
    requiredSatisfied: Number(row.required_satisfied),
    requiredOverdue: Number(row.required_overdue),
    optionalTotal: Number(row.optional_total),
    optionalSatisfied: Number(row.optional_satisfied),
    byOwnerKindOutstanding: Object.fromEntries(
      outstanding.map((entry) => [entry.owner_kind, Number(entry.outstanding)]),
    ),
  };
};
