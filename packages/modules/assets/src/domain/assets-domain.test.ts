import { describe, expect, it } from 'vitest';

import { acceptsNewAssets, createAssetCategory } from './asset-category.js';
import {
  ASSET_TAG_LIMIT,
  DESCRIPTION_LIMIT,
  LOCATION_NOTE_LIMIT,
  PURCHASE_REFERENCE_LIMIT,
  SERIAL_NUMBER_LIMIT,
  amendAsset,
  changeAssetStatus,
  registerAsset,
  type AmendAssetRequest,
  type AssetState,
} from './asset.js';
import {
  ASSET_STATUSES,
  INITIAL_ASSET_STATUS,
  PERMITTED_ASSET_TRANSITIONS,
  permitsAssetTransition,
  type AssetStatus,
} from './assets-vocabulary.js';

/**
 * The domain rules, in isolation from persistence, the dispatcher and the API.
 *
 * Nothing here touches a database. What is asserted is the shape of the decisions this module makes:
 * what a catalogue entry must carry, what identifies an item, what may be amended and what may not,
 * and which moves through the lifecycle are permitted.
 */

const NAME = { en: 'Laptop', ar: 'حاسوب محمول' };

const aCategory = (overrides: Record<string, unknown> = {}) =>
  createAssetCategory({
    assetCategoryId: 'category-1',
    code: 'laptop',
    name: NAME,
    sequence: 10,
    ...overrides,
  });

const anAsset = (overrides: Record<string, unknown> = {}) =>
  registerAsset({
    assetId: 'asset-1',
    assetCategoryId: 'category-1',
    assetTag: 'IT-00417',
    ...overrides,
  });

const registered = (overrides: Record<string, unknown> = {}): AssetState => {
  const created = anAsset(overrides);

  if (!created.ok) throw new Error(`Refused: ${created.error.reason}`);
  return created.value;
};

describe('the asset catalogue', () => {
  it('is a tenant’s own vocabulary and ships with nothing in it', () => {
    const created = aCategory();

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.value.code).toBe('laptop');
    expect(created.value.active).toBe(true);
    expect(created.value.version).toBe(1);
  });

  it('refuses a code that is not the repository’s code shape', () => {
    for (const code of ['Laptop', 'laptop_', '-laptop', 'laptop-', 'la ptop', '']) {
      const created = aCategory({ code });

      expect(created.ok).toBe(false);
      if (created.ok) continue;
      expect(created.error.reason).toBe('category_code_malformed');
    }
  });

  /**
   * Both languages, required by the domain rather than by a screen.
   *
   * This is the dropdown somebody picks from while registering every item the company owns, and a
   * category named only in English is one an Arabic-speaking storekeeper cannot read.
   */
  it('requires a name in both languages', () => {
    for (const name of [
      { en: '', ar: 'حاسوب' },
      { en: 'Laptop', ar: '   ' },
    ]) {
      const created = aCategory({ name });

      expect(created.ok).toBe(false);
      if (created.ok) continue;
      expect(created.error.reason).toBe('category_name_incomplete');
    }
  });

  it('requires a non-negative whole number for ordering', () => {
    for (const sequence of [-1, 1.5, Number.NaN]) {
      const created = aCategory({ sequence });

      expect(created.ok).toBe(false);
    }
  });

  it('does not force a unique sequence, because reads order by (sequence, code)', () => {
    const first = aCategory({ assetCategoryId: 'a', code: 'laptop', sequence: 10 });
    const second = aCategory({ assetCategoryId: 'b', code: 'monitor', sequence: 10 });

    expect(first.ok && second.ok).toBe(true);
  });

  it('stops accepting new assets when it is deactivated, and is never deleted', () => {
    const created = aCategory({ active: false });

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(acceptsNewAssets(created.value)).toBe(false);
  });

  /**
   * The fields the specification puts on `AssetCategory` that this checkpoint deliberately omits.
   *
   * Asserted as absent rather than left to a reader's inspection: each configures a capability
   * Checkpoint 1 does not build, and two of them are downstream of decisions that are still open
   * (D-5.3-05, D-5.3-03). A stored flag nothing maintains is worse than no flag (ADR-0070).
   */
  it('carries no condition scale, no valuation basis and no custody requirements', () => {
    const created = aCategory();

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const fields = Object.keys(created.value);

    for (const absent of [
      'conditionScale',
      'conditions',
      'valuationBasis',
      'valuation',
      'acknowledgementRequired',
      'returnRequired',
      'depreciation',
      'countryPackId',
    ]) {
      expect(fields).not.toContain(absent);
    }
  });
});

describe('an item in the inventory', () => {
  it('starts registered, and the caller does not choose', () => {
    expect(registered().status).toBe('registered');
    expect(INITIAL_ASSET_STATUS).toBe('registered');
  });

  it('requires a tag, which is the tenant’s own identifier', () => {
    for (const assetTag of ['', '   ']) {
      const created = anAsset({ assetTag });

      expect(created.ok).toBe(false);
      if (created.ok) continue;
      expect(created.error.reason).toBe('asset_tag_missing');
    }
  });

  it('bounds every piece of text it stores', () => {
    const cases: readonly (readonly [string, number, string])[] = [
      ['assetTag', ASSET_TAG_LIMIT, 'asset_tag_too_long'],
      ['serialNumber', SERIAL_NUMBER_LIMIT, 'serial_number_too_long'],
      ['description', DESCRIPTION_LIMIT, 'description_too_long'],
      ['locationNote', LOCATION_NOTE_LIMIT, 'location_note_too_long'],
      ['purchaseReference', PURCHASE_REFERENCE_LIMIT, 'purchase_reference_too_long'],
    ];

    for (const [field, limit, reason] of cases) {
      const created = anAsset({ [field]: 'x'.repeat(limit + 1) });

      expect(created.ok).toBe(false);
      if (created.ok) continue;
      expect(created.error.reason).toBe(reason);
    }
  });

  /**
   * A serial number is optional, and a blank one is absent rather than empty.
   *
   * A chair has no serial number. If a blank string were stored, the uniqueness index would treat
   * every unserialled item as colliding with every other — and a screen would render an empty
   * string as a serial number nobody wrote.
   */
  it('treats a blank optional as absent, never as an empty value', () => {
    const item = registered({ serialNumber: '   ', description: '', locationNote: '  ' });

    expect(item.serialNumber).toBeUndefined();
    expect(item.description).toBeUndefined();
    expect(item.locationNote).toBeUndefined();
  });

  it('trims what it stores, so two tags that differ only by spacing are one tag', () => {
    expect(registered({ assetTag: '  IT-00417 ' }).assetTag).toBe('IT-00417');
  });

  it('carries no holder, no employment, no person and no amount', () => {
    const fields = Object.keys(
      registered({
        serialNumber: 'SN-1',
        description: 'd',
        locationNote: 'l',
        purchaseReference: 'p',
      }),
    );

    for (const absent of [
      'employmentId',
      'personId',
      'custodianId',
      'holderId',
      'currentCustodyId',
      'issuedTo',
      'isIssued',
      'condition',
      'value',
      'amount',
      'cost',
      'depreciation',
    ]) {
      expect(fields).not.toContain(absent);
    }
  });
});

describe('amending an item', () => {
  it('corrects the text somebody typed', () => {
    const amended = amendAsset({ asset: registered(), description: 'Dell Latitude 5540' });

    expect(amended.ok).toBe(true);
    if (!amended.ok) return;
    expect(amended.value.description).toBe('Dell Latitude 5540');
  });

  it('leaves an absent field unchanged rather than clearing it', () => {
    const held = registered({ serialNumber: 'SN-1', locationNote: 'Store room' });
    const amended = amendAsset({ asset: held, description: 'A note' });

    expect(amended.ok).toBe(true);
    if (!amended.ok) return;
    expect(amended.value.serialNumber).toBe('SN-1');
    expect(amended.value.locationNote).toBe('Store room');
  });

  /**
   * The identity and the status survive an amendment, whatever the caller sends.
   *
   * The command type does not carry them, and the domain would ignore them if it did — which is what
   * makes "the tag is the item's identity" a property rather than a convention.
   */
  it('never changes the category, the tag or the status', () => {
    const held = registered();
    // Typed as the request intersected with an open record rather than asserted through `never`:
    // the extra keys are genuinely present at runtime, which is what the assertion needs, and the
    // call stays type-safe — a request that legitimately grew one of these fields would fail to
    // compile here instead of silently passing.
    const smuggled: AmendAssetRequest & Record<string, unknown> = {
      asset: held,
      assetCategoryId: 'other',
      assetTag: 'OTHER-1',
      status: 'retired',
    };
    const amended = amendAsset(smuggled);

    expect(amended.ok).toBe(true);
    if (!amended.ok) return;
    expect(amended.value.assetCategoryId).toBe('category-1');
    expect(amended.value.assetTag).toBe('IT-00417');
    expect(amended.value.status).toBe('registered');
  });

  it('re-checks the bounds, so an amendment cannot do what a registration could not', () => {
    const amended = amendAsset({
      asset: registered(),
      description: 'x'.repeat(DESCRIPTION_LIMIT + 1),
    });

    expect(amended.ok).toBe(false);
  });
});

describe('the in-service lifecycle', () => {
  it('permits exactly the moves the transition table states, and no others', () => {
    const pairs = ASSET_STATUSES.flatMap((from) => ASSET_STATUSES.map((to) => [from, to] as const));

    expect(pairs).toHaveLength(16);

    for (const [from, to] of pairs) {
      expect(permitsAssetTransition(from, to)).toBe(PERMITTED_ASSET_TRANSITIONS[from].includes(to));
    }
  });

  it('makes retirement terminal', () => {
    expect(PERMITTED_ASSET_TRANSITIONS.retired).toEqual([]);

    const moved = changeAssetStatus({
      asset: { ...registered(), status: 'retired' },
      status: 'available',
    });

    expect(moved.ok).toBe(false);
    if (moved.ok) return;
    expect(moved.error.reason).toBe('asset_transition_refused');
  });

  it('lets a repair round-trip', () => {
    const inService = changeAssetStatus({ asset: registered(), status: 'available' });

    expect(inService.ok).toBe(true);
    if (!inService.ok) return;

    const sent = changeAssetStatus({ asset: inService.value, status: 'under_repair' });

    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(changeAssetStatus({ asset: sent.value, status: 'available' }).ok).toBe(true);
  });

  /**
   * A move to the status the asset already holds is refused, not silently accepted.
   *
   * An operation that reports success without changing anything is how a caller comes to believe a
   * state machine advanced when it did not.
   */
  it('refuses a move to the status the item already has', () => {
    expect(changeAssetStatus({ asset: registered(), status: 'registered' }).ok).toBe(false);
  });

  it('refuses a status that is not in the vocabulary', () => {
    for (const status of ['issued', 'in_custody', 'returned', 'lost', 'assigned', 'disposed']) {
      const moved = changeAssetStatus({ asset: registered(), status });

      expect(moved.ok).toBe(false);
      if (moved.ok) continue;
      expect(moved.error.reason).toBe('asset_status_unknown');
    }
  });

  /**
   * The three custody states are absent from the vocabulary, and that is the design.
   *
   * They are facts about custody, derived from the custody history when Checkpoint 2 creates it. A
   * copy on the asset would be a second answer that goes stale (ADR-0070, D-5.2-16).
   */
  it('holds four statuses, and none of them says who is holding the item', () => {
    const statuses: readonly string[] = ASSET_STATUSES;

    expect(statuses).toEqual(['registered', 'available', 'under_repair', 'retired']);

    for (const custody of ['issued', 'in_custody', 'returned', 'pending_return', 'outstanding']) {
      expect(statuses).not.toContain(custody);
    }
  });

  it('exposes a transition table covering every status exactly once', () => {
    const covered = Object.keys(PERMITTED_ASSET_TRANSITIONS) as readonly AssetStatus[];

    expect([...covered].sort()).toEqual([...ASSET_STATUSES].sort());
  });
});
