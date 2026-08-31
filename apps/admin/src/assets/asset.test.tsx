import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { assetsTranslator } from './locale';
import { AssetFacts, CustodyHistory, CurrentCustody, CustodySections } from './asset';
import {
  BARE_ASSET,
  CATEGORY_PHONE,
  EMPLOYMENT_A,
  EMPLOYMENT_B,
  LAPTOP_ASSET,
  aNeverIssuedAsset,
  anAssetContext,
  anAssetCustody,
  anUnheldAssetCustody,
  anUnnamedCategoryContext,
  aWithheldCustodyContext,
} from './assets.fixture';

/**
 * One asset and its custody chain.
 *
 * The properties under test are the ones this screen could most plausibly get wrong: that an asset
 * nobody holds is not confused with one nobody has ever been issued, that no day count is computed
 * here, that a refused custody read produces one withheld section rather than two, and that the
 * employment on a custody row stays an identifier because Assets publishes no name for anybody.
 */

const en = assetsTranslator('en');
const ar = assetsTranslator('ar');

const html = (node: ReactNode): string => renderToStaticMarkup(node);

describe('what is recorded about the asset', () => {
  it('renders every absent optional as a dash rather than a blank', () => {
    const markup = html(
      <AssetFacts t={en} language="en" asset={BARE_ASSET} context={anAssetContext()} />,
    );

    // Serial, description, location and purchase reference are all absent on this fixture.
    expect(markup.match(/—/gu)?.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps the in-service status separate from who is holding it', () => {
    const markup = html(
      <AssetFacts t={en} language="en" asset={LAPTOP_ASSET} context={anAssetContext()} />,
    );

    expect(markup).toContain(en('assets.status.available'));
    // The holder is a custody fact and does not appear among the item's own facts.
    expect(markup).not.toContain(EMPLOYMENT_A);
  });

  it('falls back to the category identifier when the catalogue was withheld', () => {
    const markup = html(
      <AssetFacts t={en} language="en" asset={BARE_ASSET} context={anUnnamedCategoryContext()} />,
    );

    expect(markup).toContain(CATEGORY_PHONE);
  });
});

describe('who holds it now', () => {
  it('distinguishes an asset nobody holds from one nobody has ever held', () => {
    const unheld = html(
      <CurrentCustody t={en} language="en" custody={undefined} asAt="2026-08-27" />,
    );
    const neverIssued = html(
      <CustodyHistory t={en} language="en" history={aNeverIssuedAsset().history} />,
    );

    expect(unheld).toContain(en('assets.empty.noHolder'));
    expect(neverIssued).toContain(en('assets.empty.custody'));
    expect(en('assets.empty.noHolder')).not.toEqual(en('assets.empty.custody'));
  });

  it('never fills an absent current custody from the first row of the history', () => {
    const custody = anUnheldAssetCustody();
    const markup = html(
      <CurrentCustody t={en} language="en" custody={custody.current} asAt={custody.asAt} />,
    );

    // The history holds a returned custody for EMPLOYMENT_B; nothing may promote it to "current".
    expect(markup).not.toContain(EMPLOYMENT_B);
    expect(markup).toContain(en('assets.empty.noHolder'));
  });

  it('links the holder to their employee record by a published identifier', () => {
    const custody = anAssetCustody();
    const markup = html(
      <CurrentCustody t={en} language="en" custody={custody.current} asAt={custody.asAt} />,
    );

    expect(markup).toContain(`href="/employment/${EMPLOYMENT_A}?lang=en"`);
    expect(markup).toContain(EMPLOYMENT_A);
  });
});

describe('the custody history', () => {
  it('shows the day count the module published, and only that one', () => {
    const markup = html(<CustodyHistory t={en} language="en" history={anAssetCustody().history} />);

    // 87 outstanding on the open custody, 207 held on the returned one. Neither is computed here.
    expect(markup).toContain('87');
    expect(markup).toContain('207');
  });

  it('reports the server total beside the rows it received', () => {
    const markup = html(<CustodyHistory t={en} language="en" history={anAssetCustody().history} />);

    expect(markup).toContain('2 / 2');
  });

  it('translates the custody state in both languages', () => {
    const english = html(
      <CustodyHistory t={en} language="en" history={anAssetCustody().history} />,
    );
    const arabic = html(<CustodyHistory t={ar} language="ar" history={anAssetCustody().history} />);

    expect(english).toContain(en('assets.custodyState.returned'));
    expect(arabic).toContain(ar('assets.custodyState.returned'));
  });
});

describe('when custody is refused', () => {
  it('renders one withheld section rather than two, and never an empty history', () => {
    const markup = html(
      <CustodySections
        t={en}
        language="en"
        asset={LAPTOP_ASSET}
        context={aWithheldCustodyContext()}
      />,
    );

    expect(markup.match(new RegExp(en('assets.withheld.custodyRead'), 'gu'))?.length).toBe(1);
    expect(markup).not.toContain(en('assets.empty.custody'));
    expect(markup).not.toContain(en('assets.empty.noHolder'));
  });
});
