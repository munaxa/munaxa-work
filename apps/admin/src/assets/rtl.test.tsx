import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Figure, Isolated, Wrote, shownOf } from './frame';
import { assetsTranslator } from './locale';
import { CatalogueSection, InventorySection, SummarySection } from './inventory';
import { AssetFacts, CurrentCustody, CustodyHistory } from './asset';
import { LAPTOP_ASSET, aFullInventory, anAssetContext, anAssetCustody } from './assets.fixture';

/**
 * Every Latin run inside Arabic, and what happens when one is not isolated.
 *
 * An assets screen is unusually dense in Latin runs even in Arabic: an asset tag, a serial number,
 * a purchase reference, two civil dates, an employment identifier and two day counts, on every row.
 * All of them are values somebody stored or the module derived, none of them is a label this
 * product ships, and each is a candidate for reordering by the bidirectional algorithm.
 *
 * **A ratio must be one isolate, not two.** Isolating only the total leaves the page count as a
 * second left-to-right run, and inside an Arabic paragraph the later run comes first: `2 / 26`
 * renders as `26 / 2`, which reads as a page bigger than its own total.
 */

const ar = assetsTranslator('ar');
const html = (node: ReactNode): string => renderToStaticMarkup(node);

describe('the isolation primitives', () => {
  it('isolates an identifier without forcing its direction', () => {
    expect(html(<Isolated>{'01900000-0000-7000-8000-0000000a5501'}</Isolated>)).toBe(
      '<bdi>01900000-0000-7000-8000-0000000a5501</bdi>',
    );
  });

  it('forces a day count left to right, because a count can arrive beside a neutral character', () => {
    expect(html(<Figure>{'87'}</Figure>)).toBe('<bdi dir="ltr">87</bdi>');
  });

  it('isolates free text so its own first strong character decides its direction', () => {
    // An English note in an Arabic table keeps its trailing full stop where it belongs.
    expect(html(<Wrote>{'Issued for the Riyadh rollout.'}</Wrote>)).toBe(
      '<bdi>Issued for the Riyadh rollout.</bdi>',
    );
  });

  it('renders a dash rather than an empty isolate for an absent value', () => {
    expect(html(<Wrote>{undefined}</Wrote>)).toBe('<span>—</span>');
  });

  it('puts the whole ratio in one isolate rather than isolating the total alone', () => {
    expect(html(<>{shownOf({ items: [1, 2], total: 26 })}</>)).toBe('<bdi>2 / 26</bdi>');
  });

  it('renders nothing at all for a listing that was refused', () => {
    expect(html(<>{shownOf(undefined)}</>)).toBe('');
  });
});

describe('every Latin run on an Arabic assets screen is isolated', () => {
  /**
   * Anything outside a `<bdi>` that is a run of Latin letters, digits or the separators around them
   * is a candidate for reordering. The catalogue's own Arabic text is Arabic, so what is left in
   * the stripped markup should be Arabic and punctuation only.
   */
  const unisolated = (markup: string): readonly string[] => {
    const withoutTags = markup
      .replaceAll(/<bdi[^>]*>.*?<\/bdi>/g, '')
      // Prose from the catalogue is the translator's own sentence, not a value this screen
      // composed. A number a translator wrote into an Arabic paragraph is ordered correctly by the
      // bidirectional algorithm without help; what this test is for is the values the *screen*
      // puts beside that prose.
      .replaceAll(/<p\b[^>]*>.*?<\/p>/g, '')
      .replaceAll(/<[^>]+>/g, ' ')
      .replaceAll('&#x27;', "'")
      .replaceAll('&quot;', '"');

    return withoutTags.match(/[A-Za-z0-9][A-Za-z0-9.,:%/-]*/g) ?? [];
  };

  /**
   * The detector itself, asserted before anything is asserted with it.
   *
   * Every sweep below passed on its first run, which in three earlier slices meant the helper was
   * blind rather than the markup clean. This renders a value deliberately outside a `<bdi>` and
   * requires that it is caught, so a sweep that passes is a sweep that could have failed.
   */
  it('catches a value that is not isolated', () => {
    expect(unisolated('<td>LT-000418</td>')).toEqual(['LT-000418']);
    expect(unisolated('<td><bdi>LT-000418</bdi></td>')).toEqual([]);
  });

  it('leaves no bare tag, serial, status or category name on the inventory', () => {
    const markup = html(<InventorySection t={ar} language="ar" inventory={aFullInventory()} />);

    expect(unisolated(markup)).toEqual([]);
  });

  it('leaves no bare code or sequence in the catalogue', () => {
    const markup = html(<CatalogueSection t={ar} language="ar" inventory={aFullInventory()} />);

    expect(unisolated(markup)).toEqual([]);
  });

  it('leaves no bare count or date in the outstanding summary', () => {
    const markup = html(<SummarySection t={ar} language="ar" inventory={aFullInventory()} />);

    expect(unisolated(markup)).toEqual([]);
  });

  it('leaves no bare value among an asset’s own facts', () => {
    const markup = html(
      <AssetFacts t={ar} language="ar" asset={LAPTOP_ASSET} context={anAssetContext()} />,
    );

    // A serial number, a purchase reference and a description with a straight quote in it.
    expect(unisolated(markup)).toEqual([]);
  });

  it('leaves no bare identifier, date or day count on the custody chain', () => {
    const custody = anAssetCustody();
    const markup = [
      html(<CurrentCustody t={ar} language="ar" custody={custody.current} asAt={custody.asAt} />),
      html(<CustodyHistory t={ar} language="ar" history={custody.history} />),
    ].join('');

    expect(unisolated(markup)).toEqual([]);
  });
});
