import type { Transaction } from '@work/kernel';

import type { RecruitmentDependencies } from './recruitment-dependencies.js';

/**
 * Recruitment's business numbers: `REQ-2026-000001`, `CAN-2026-000042`, `APP-2026-001337`.
 *
 * **Recruitment's own counter, not Employment's** (A-8). Sharing one would couple two modules'
 * numbering forever, and a customer auditing their requisition numbers would find gaps explained by
 * hires. A global PostgreSQL sequence is refused for the reasons ADR-0039 already gives: it is
 * neither tenant-scoped — so one customer could infer another's volume from the gaps — nor
 * transactional, so a create that rolled back would burn a number permanently.
 *
 * The series is the calendar year the record is created in, which is what makes the number mean
 * what it appears to mean. Numbers past `999999` widen rather than wrap: wrapping would reuse one,
 * and a reused number resolves two records years apart.
 *
 * The counter itself is deliberately **not** extracted into the kernel here. Employment's report
 * already recorded a reusable tenant-scoped sequence as debt, and a second consumer is the moment
 * to consider extracting it — not to do it inside a business phase (A-8).
 */

const WIDTH = 6;

export type NumberSeries = 'requisition' | 'candidate' | 'application' | 'offer';

export const allocateNumber = async (
  transaction: Transaction,
  dependencies: RecruitmentDependencies,
  series: NumberSeries,
  prefix: string,
  now: Date,
): Promise<string> => {
  const year = now.toISOString().slice(0, 4);
  const next = await dependencies.stores.numbers.allocate(transaction, `${series}:${year}`);

  return `${prefix}-${year}-${String(next).padStart(WIDTH, '0')}`;
};

/** The shape a generated number matches, checked on the way back in as well as on the way out. */
export const isRecruitmentNumber = (value: string): boolean =>
  /^(REQ|CAN|APP|OFR)-\d{4}-\d{6,}$/.test(value);
