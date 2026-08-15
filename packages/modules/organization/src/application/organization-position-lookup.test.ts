import { beforeEach, describe, expect, it } from 'vitest';
import { assertSucceeded } from '@work/testing';
import type { PagedResult } from '@work/kernel';

import type { PositionView } from '../contracts/views.js';

import {
  JANUARY,
  TENANT_A,
  ask,
  asTenant,
  harnessFor,
  send,
  type Harness,
} from './organization-test-harness.js';

/**
 * The exact-identifier filter on `organization.list-positions`.
 *
 * Added for Phase 15 as the smallest additive change that lets a consumer holding a position
 * identifier confirm it exists **in one bounded request**. Career stores `position_id` on a
 * succession plan, a career stage and a mobility recommendation and could not confirm any of them:
 * the existing filters are `status`, `family` and a free-text `term` over `code` and the title in
 * either language, and none of them touches `id`. The alternative was paging the whole catalogue and
 * filtering in the consumer — unbounded work over this module's data, returning a `total` that
 * answered a different question.
 *
 * **This does not make critical-position enumeration possible.** The filter narrows a result the
 * caller could already obtain, with the same `organization.position.read` permission, down to the
 * single row they already named. It adds no way to *discover* a position by any property, least of
 * all criticality — D-4 stays `NOT VERIFIED`, and the suite below asserts that the response is
 * unchanged in shape and that the filter cannot be used to search.
 */

const bilingual = (en: string, ar: string): Record<string, string> => ({ en, ar });

interface PositionCreated {
  readonly positionId: string;
}

describe('organization.list-positions, by exact identifier', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor(TENANT_A);
  });

  const definePosition = async (code: string, title: string): Promise<string> => {
    const created = assertSucceeded(
      await asTenant(TENANT_A, () =>
        send<PositionCreated>(harness, {
          commandName: 'organization.define-position',
          code,
          title: bilingual(title, title),
          effectiveFrom: JANUARY,
        }),
      ),
    );

    return created.positionId;
  };

  const listing = (filters: Record<string, unknown>): Promise<PagedResult<PositionView>> =>
    asTenant(TENANT_A, () =>
      ask<PagedResult<PositionView>>(harness, {
        queryName: 'organization.list-positions',
        ...filters,
      }),
    ).then(assertSucceeded);

  it('returns exactly the named position, and the response shape is unchanged', async () => {
    const wanted = await definePosition('finance-director', 'Finance director');

    await definePosition('engineering-lead', 'Engineering lead');
    await definePosition('operations-head', 'Operations head');

    const found = await listing({ positionId: wanted });

    expect(found.items).toHaveLength(1);
    expect(found.items[0]?.id).toBe(wanted);
    expect(found.items[0]?.code).toBe('finance-director');
    // The same `PagedResult<PositionView>` every other caller receives — same fields, same paging.
    expect(found.total).toBe(1);
    expect(found.page).toBe(1);
  });

  /** The permitted case has a refusal beside it: an identifier nobody defined matches nothing. */
  it('returns an empty page for an identifier that names no position', async () => {
    await definePosition('finance-director', 'Finance director');

    const found = await listing({ positionId: '01930000-0000-7000-8000-00000000ffff' });

    expect(found.items).toEqual([]);
    expect(found.total).toBe(0);
  });

  /**
   * Absent, nothing changes.
   *
   * The assertion that matters for every existing caller: the same query without the new field
   * returns exactly what it returned before.
   */
  it('changes nothing when the filter is absent', async () => {
    await definePosition('finance-director', 'Finance director');
    await definePosition('engineering-lead', 'Engineering lead');

    const all = await listing({});

    expect(all.total).toBe(2);
    expect(all.items.map((position) => position.code).sort()).toEqual([
      'engineering-lead',
      'finance-director',
    ]);
  });

  /**
   * It confirms; it does not discover.
   *
   * An identifier filter cannot be used to search, because there is no partial identifier to search
   * with — combining it with another filter narrows further rather than widening, and combining it
   * with a filter the position does not match returns nothing rather than the position.
   */
  it('narrows rather than widens when combined with another filter', async () => {
    const wanted = await definePosition('finance-director', 'Finance director');

    const matching = await listing({ positionId: wanted, status: 'active' });
    const contradicting = await listing({ positionId: wanted, status: 'retired' });

    expect(matching.items).toHaveLength(1);
    expect(contradicting.items).toEqual([]);
  });

  it('still pages the unfiltered catalogue exactly as before', async () => {
    for (const index of [1, 2, 3, 4, 5]) {
      await definePosition(`position-${String(index)}`, `Position ${String(index)}`);
    }

    const first = await listing({ page: 1, size: 2 });
    const second = await listing({ page: 2, size: 2 });

    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(2);
    expect(first.total).toBe(5);
    expect(second.total).toBe(5);
  });
});
