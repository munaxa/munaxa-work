import { accept, refuse, type AssetsResult } from '../domain/assets-rejection.js';
import { civilDateOf, isCivilDate } from '../domain/custody-ageing.js';
import type { AssetsDependencies } from './assets-dependencies.js';

/**
 * The date a read measures against: the caller's if they gave one, otherwise the server's own day.
 *
 * Extracted from `custody-queries.ts` when clearance needed the same rule. One place decides what
 * `asAt` means, so the three reads that publish an elapsed figure cannot come to disagree about which
 * dates are acceptable — and the one that was wrong would be the one quietly reporting against a
 * different day than it claimed.
 *
 * **A malformed value is refused, never replaced with today.** A quietly substituted date produces a
 * report that is internally consistent and answers a different question than the one asked, which is
 * the failure nobody notices.
 *
 * **A future `asAt` is permitted.** "How old will this be at year end" is a fair question, the
 * arithmetic is identical, and nothing is persisted, so no future date can reach a record.
 */
export const asAtFrom = (
  asAt: string | undefined,
  dependencies: AssetsDependencies,
): AssetsResult<string> => {
  if (asAt === undefined) return accept(civilDateOf(dependencies.clock.now()));
  return isCivilDate(asAt) ? accept(asAt) : refuse('as_at_malformed', { field: 'asAt' });
};
