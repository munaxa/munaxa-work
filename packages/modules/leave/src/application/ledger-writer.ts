import type { Transaction } from '@work/kernel';

import { markStale, openBalance, type BalanceState } from '../domain/balance.js';
import { accept, type LeaveResult } from '../domain/leave-rejection.js';
import { ledgerEntry, type LedgerBucket, type LedgerEntryState } from '../domain/ledger.js';
import type { LeaveYear } from '../domain/leave-year.js';
import type { WriteLedgerEntry } from '../domain/ledger.js';
import type { LeaveDependencies } from './leave-dependencies.js';

/**
 * The one way anything is written to the ledger, and the reason it is one way.
 *
 * Three things have to happen together or the module is wrong, and putting them in one function is
 * what stops the fourth writer from doing two of them:
 *
 * 1. **The idempotency read.** `(sourceKind, sourceId, kind)` is the unique index every writer
 *    rests on. An accrual run repeated, an approval retried, a leave-year close rerun — each finds
 *    its entry already there and writes nothing. This is what makes a bounded run safe to restart
 *    rather than something an operator has to be careful with.
 *
 * 2. **The balance's stale mark, in the same transaction.** Not afterwards, not in a handler, not
 *    on the strength of an event — the mark and the entry commit together or neither does. Event
 *    delivery here is post-commit, in-process and at-most-once with no outbox, so a projection that
 *    waited to be told would sometimes wait for ever, and a stale balance looks exactly like a
 *    correct one (ADR-0053).
 *
 * 3. **`balanceBefore` and `balanceAfter` captured at the moment of writing**, so "what did this
 *    adjustment change" is answerable without replaying the ledger (§25).
 *
 * The balance row is **opened if it does not exist**, with its stale mark set, so a bucket's first
 * entry still reaches the reconciliation queue. A ledger entry with no projection behind it would
 * be a movement nothing ever summed.
 */

export interface LedgerWrite extends Omit<
  WriteLedgerEntry,
  'balanceBeforeMinutes' | 'leaveYearStart'
> {
  /** The leave year, whole. The bucket key comes from its start; the caller never spells it twice. */
  readonly leaveYear: LeaveYear;
}

export interface LedgerWriteOutcome {
  readonly entry: LedgerEntryState;
  /** False where the entry was already present. The count that demonstrates idempotency. */
  readonly written: boolean;
}

export const appendToLedger = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  write: LedgerWrite,
): Promise<LeaveResult<LedgerWriteOutcome>> => {
  const existing = await dependencies.stores.ledger.bySource(transaction, {
    sourceKind: write.sourceKind,
    sourceId: write.sourceId,
    kind: write.kind,
  });

  if (existing !== undefined) return accept({ entry: existing, written: false });

  const bucket: LedgerBucket = {
    employmentId: write.employmentId,
    leaveTypeId: write.leaveTypeId,
    leaveYearStart: write.leaveYear.start,
  };
  const now = dependencies.clock.now();
  const balance = await balanceFor(transaction, dependencies, write, bucket, now);
  const entry = ledgerEntry(
    {
      ...write,
      leaveYearStart: write.leaveYear.start,
      balanceBeforeMinutes: balance.availableMinutes,
    },
    now,
  );

  if (!entry.ok) return entry;

  await dependencies.stores.ledger.insert(transaction, entry.value);
  await dependencies.stores.balances.update(transaction, markStale(balance, now), balance.version);

  return accept({ entry: entry.value, written: true });
};

/**
 * The balance row the entry belongs to, opened where the bucket is new.
 *
 * Opened rather than left absent because the stale mark has to live somewhere, and a bucket whose
 * first ledger entry arrived before anything read it would otherwise never appear in the
 * reconciliation queue.
 */
const balanceFor = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  write: LedgerWrite,
  bucket: LedgerBucket,
  now: Date,
): Promise<BalanceState> => {
  const found = await dependencies.stores.balances.forBucket(transaction, bucket);

  if (found !== undefined) return found;

  const state = openBalance(
    {
      tenantId: write.tenantId,
      employmentId: write.employmentId,
      leaveTypeId: write.leaveTypeId,
      leaveYear: write.leaveYear,
    },
    now,
  );

  await dependencies.stores.balances.insert(transaction, state);

  // Re-read rather than returning the value just built: an insert stamps `version` to 1, and the
  // optimistic update that follows compares against it. Returning the pre-insert state would make
  // every first entry in a bucket fail on a version nobody had changed.
  return (await dependencies.stores.balances.forBucket(transaction, bucket)) ?? state;
};
