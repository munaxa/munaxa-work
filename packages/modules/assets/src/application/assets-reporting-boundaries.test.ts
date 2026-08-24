import { describe, expect, it } from 'vitest';

import { ALL_CODE, ASSETS_MIGRATION_SQL, IDENTIFIERS } from './source-scan.fixture.js';

/**
 * The negative space Checkpoint 3 is responsible for.
 *
 * Its sibling `assets-boundaries.test.ts` holds what Checkpoints 1 and 2 did not build. These are the
 * absences reporting could erode, and they erode quietly: a derived figure is one commit away from
 * being a cached column, an aggregate count is one field away from being a list of who holds what,
 * and an elapsed-days report is one threshold away from asserting a business rule nobody agreed.
 */

describe('what reporting deliberately does not persist, publish or decide', () => {
  /**
   * Checkpoint 3 publishes elapsed days and persists none of them.
   *
   * A stored `days_outstanding` is correct on the day it is written and wrong every day after
   * (ADR-0070), which is the same reasoning that kept `in_custody` off `asset`. The figures are
   * arithmetic over `issued_on` and `returned_on`, and this asserts there is nowhere to put a copy:
   * no column in the migrations, and no field on any state the module persists.
   */
  it('persists no ageing figure, and no column exists to hold one', () => {
    for (const absent of [
      'daysOutstandingColumn',
      'days_outstanding',
      'days_held',
      'age_days',
      'aged_at',
      'outstanding_since',
      'last_aged',
    ]) {
      expect(IDENTIFIERS).not.toContain(absent);
    }

    // Asserted against the migrations themselves, not only against TypeScript: a column added in SQL
    // that no type mentioned is exactly the copy this rule exists to prevent.
    //
    // The two tables are named first, so a scan that silently found no migration at all — a moved
    // directory, a renamed file — fails here rather than passing every absence vacuously.
    expect(ASSETS_MIGRATION_SQL).toContain('create table asset_custody');
    expect(ASSETS_MIGRATION_SQL).toContain('create table asset');

    for (const absent of ['days_outstanding', 'days_held', 'age_days', 'outstanding_since']) {
      expect(ASSETS_MIGRATION_SQL).not.toContain(absent);
    }

    // And the positive half — the figures exist, computed.
    expect(ALL_CODE).toContain('custodyAgeing');
  });

  /**
   * The reporting read added in Checkpoint 3 is an aggregate, and the tenant-wide *listing* stays
   * unbuilt.
   *
   * These are two different things and the distinction is the whole justification for the summary:
   * a count discloses that twelve items have been out for two years; a listing discloses who holds
   * them. The store offers `openSummary` and no `all`, `everyCustody` or unfiltered page.
   */
  it('counts custody across the tenant without publishing a list of it', () => {
    expect(IDENTIFIERS).toContain('openSummary');

    for (const absent of [
      'allCustodies',
      'everyCustody',
      'listAllCustody',
      'custodyRegister',
      'currentHolders',
    ]) {
      expect(IDENTIFIERS).not.toContain(absent);
    }
  });

  /**
   * No bucketing, because a bucket boundary is a business threshold.
   *
   * A report that grouped custody into 30/60/90 days would be stating that thirty days means
   * something, and no line of this repository says so. The summary publishes a count and the largest
   * elapsed figure, and leaves the threshold to whoever is entitled to set one.
   */
  it('invents no ageing threshold and no bucket', () => {
    for (const absent of [
      'bucket',
      'threshold',
      'agingBand',
      'ageingBand',
      'staleAfter',
      'breach',
    ]) {
      expect(IDENTIFIERS).not.toContain(absent);
    }
  });

  /**
   * The reporting reads answer a question about custody and never about employment.
   *
   * D-5.3-01 — what should happen to a custody whose employment has ended — is **open**, and a read
   * that filtered or flagged by employment status would answer it. Nothing here holds a status, an
   * end date or a termination flag, and D-5.3-11 settled that Assets does not learn of an ending at
   * all: it is asked, it never subscribes.
   */
  it('holds no employment status, no end date and no termination flag', () => {
    for (const absent of [
      'employmentStatus',
      'employment_status',
      'employmentEnded',
      'employment_ended',
      'endDate',
      'end_date',
      'terminated',
      'termination',
      'offboarded',
      'onEmploymentEnded',
    ]) {
      expect(IDENTIFIERS).not.toContain(absent);
    }
  });
});
