import { createHash } from 'node:crypto';

import { uuidV7 } from '@work/kernel';

import { withoutKey } from './leave-aggregate.js';
import type { LedgerEntryState } from './ledger.js';
import type { LeaveYear } from './leave-year.js';

/**
 * A balance: a projection of the ledger, and never anything a command writes directly.
 *
 * **No command increments a balance.** There is no `add`, no `consume` and no `credit` on this
 * type. The only way a row here changes is `recalculate`, which sums the ledger entries it is given
 * and replaces the figures wholesale. A projection that could be incremented is a projection that
 * will eventually be incremented twice, and a leave balance that is wrong by one day is
 * indistinguishable from one that is right.
 *
 * **The digest is what makes a wrong figure detectable rather than merely plausible.** It is
 * computed from the identities and minutes of every entry that produced the figures, so a
 * recalculation over unchanged inputs produces an unchanged digest and can say `unchanged` honestly
 * — and a figure whose digest does not match its ledger is a defect a test can find.
 *
 * **`inputsChangedAt` is a mark, not a comparison.** It is written in the same transaction as the
 * ledger entry that moved the balance, and it is cleared by recalculation. The reconciliation query
 * and the partial index behind it both test *presence of the mark*, never `inputsChangedAt >
 * calculatedAt` — a comparison loses an input that moved within the same clock tick as the
 * calculation it invalidates, and loses it silently (ADR-0053, and the Phase 8 defect that proved
 * it).
 *
 * **`availableMinutes` may be negative** where the policy permits it, so nothing here clamps it. A
 * balance clamped at zero would hide exactly the situation somebody needs to see.
 */

export interface BalanceState {
  readonly id: string;
  readonly tenantId: string;
  readonly employmentId: string;
  readonly leaveTypeId: string;
  readonly leaveYearStart: string;
  readonly leaveYearEnd: string;
  readonly openingMinutes: number;
  readonly accruedMinutes: number;
  readonly carriedInMinutes: number;
  readonly consumedMinutes: number;
  readonly adjustedMinutes: number;
  readonly expiredMinutes: number;
  readonly carriedOutMinutes: number;
  readonly availableMinutes: number;
  readonly entriesDigest: string;
  readonly entryCount: number;
  readonly calculatedAt?: Date;
  readonly inputsChangedAt?: Date;
  /** Set when the leave year is closed. The row is retained, not deleted (§16). */
  readonly closedAt?: Date;
  readonly version: number;
}

export interface OpenBalance {
  readonly tenantId: string;
  readonly employmentId: string;
  readonly leaveTypeId: string;
  readonly leaveYear: LeaveYear;
}

/**
 * A balance that has never been calculated.
 *
 * Created with the stale mark **set**, so a bucket that gains a ledger entry before anything reads
 * it still appears in the reconciliation queue. A zeroed projection that looked calculated would be
 * a confident answer of "no leave" for somebody who has some.
 */
export const openBalance = (request: OpenBalance, at: Date): BalanceState => ({
  id: uuidV7(at.getTime()),
  tenantId: request.tenantId,
  employmentId: request.employmentId,
  leaveTypeId: request.leaveTypeId,
  leaveYearStart: request.leaveYear.start,
  leaveYearEnd: request.leaveYear.end,
  openingMinutes: 0,
  accruedMinutes: 0,
  carriedInMinutes: 0,
  consumedMinutes: 0,
  adjustedMinutes: 0,
  expiredMinutes: 0,
  carriedOutMinutes: 0,
  availableMinutes: 0,
  entriesDigest: digestOf([]),
  entryCount: 0,
  inputsChangedAt: at,
  version: 0,
});

/** Marks a balance as needing recalculation. Written in the same transaction as the ledger entry. */
export const markStale = (balance: BalanceState, at: Date): BalanceState => ({
  ...balance,
  inputsChangedAt: at,
});

/**
 * The figures, derived from the entries.
 *
 * Each component is a sum over one kind, and `availableMinutes` is the sum of **every** entry
 * rather than an expression built from the components — so a kind added later cannot silently drop
 * out of the total while the components still look right.
 *
 * `reversal` entries fall into `adjustedMinutes` for reporting, and into the total like everything
 * else. A reversal of a consumption therefore shows as a positive adjustment and a reduced net
 * consumption figure — which is what actually happened, and is why a cancellation does not delete
 * the consumption row.
 */
export interface BalanceFigures {
  readonly openingMinutes: number;
  readonly accruedMinutes: number;
  readonly carriedInMinutes: number;
  readonly consumedMinutes: number;
  readonly adjustedMinutes: number;
  readonly expiredMinutes: number;
  readonly carriedOutMinutes: number;
  readonly availableMinutes: number;
  readonly entriesDigest: string;
  readonly entryCount: number;
}

export const figuresFrom = (entries: readonly LedgerEntryState[]): BalanceFigures => ({
  openingMinutes: totalOf(entries, 'opening'),
  accruedMinutes: totalOf(entries, 'accrual'),
  carriedInMinutes: totalOf(entries, 'carry_in'),
  // Reported as a positive quantity consumed, though the entries themselves are negative: a screen
  // reading "consumed: -2400" invites somebody to subtract it twice.
  consumedMinutes: -totalOf(entries, 'consumption'),
  adjustedMinutes: totalOf(entries, 'adjustment') + totalOf(entries, 'reversal'),
  expiredMinutes: -totalOf(entries, 'expiry'),
  carriedOutMinutes: -totalOf(entries, 'carry_out'),
  availableMinutes: entries.reduce((sum, entry) => sum + entry.minutes, 0),
  entriesDigest: digestOf(entries),
  entryCount: entries.length,
});

/**
 * Recalculation: the only write a balance ever takes.
 *
 * The stale mark is cleared **whether or not the figures moved**, matching the presence-based
 * predicate the reconciliation query uses. Leaving a mark on a balance whose inputs had not moved
 * would keep it in the queue for ever, asking to be redone; that is the Phase 8 defect, and it is
 * not repeated here.
 */
export const recalculated = (
  balance: BalanceState,
  entries: readonly LedgerEntryState[],
  at: Date,
): { readonly state: BalanceState; readonly changed: boolean } => {
  const figures = figuresFrom(entries);
  const changed =
    figures.entriesDigest !== balance.entriesDigest || balance.calculatedAt === undefined;
  const cleared = withoutKey(balance, 'inputsChangedAt');

  return { state: { ...cleared, ...figures, calculatedAt: at }, changed };
};

/** Closing a leave year retains the projection and stamps it. Nothing is deleted (§16). */
export const closed = (balance: BalanceState, at: Date): BalanceState => ({
  ...balance,
  closedAt: at,
});

/**
 * The digest of a set of entries.
 *
 * Sorted by identifier so the digest does not depend on the order rows came back in, and built from
 * the identity **and the minutes** so an entry that was somehow rewritten would change it. UUIDv7
 * identifiers are time-ordered, which makes the sort stable and cheap.
 *
 * Truncated to sixty-four characters to match the column, which is the full width of a SHA-256 hex
 * digest anyway.
 */
const digestOf = (entries: readonly LedgerEntryState[]): string => {
  const parts = [...entries]
    .sort((one, other) => (one.id < other.id ? -1 : 1))
    .map((entry) => `${entry.id}:${String(entry.minutes)}:${entry.kind}`)
    .join('|');

  return createHash('sha256').update(parts).digest('hex').slice(0, 64);
};

const totalOf = (entries: readonly LedgerEntryState[], kind: string): number =>
  entries.reduce((sum, entry) => (entry.kind === kind ? sum + entry.minutes : sum), 0);
