import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { assetsTranslator } from './locale';
import { CatalogueSection, InventorySection, SummarySection } from './inventory';
import {
  ASSET_A,
  CATEGORY_PHONE,
  aFullInventory,
  aPartlyWithheldInventory,
  aRefusedInventory,
  anEmptyInventory,
} from './assets.fixture';

/**
 * The inventory screen, asserted against the markup rather than a description of it.
 *
 * Each assertion protects a property the seven completed slices settled, so a future change that
 * quietly gives one up fails here rather than reaching a customer: that a refused section never
 * reads as an empty one, that every count is the server's, that an asset opens by its own route,
 * and that a name the catalogue did not supply is never invented.
 */

const en = assetsTranslator('en');
const ar = assetsTranslator('ar');

const html = (node: ReactNode): string => renderToStaticMarkup(node);

/** An `href` as it lands in an attribute: only `&` is escaped there, not the quotes around it. */
const attribute = (href: string): string => `href="${href}"`;

describe('the asset inventory', () => {
  it('opens every asset by its own identifier, and never by its position', () => {
    const markup = html(<InventorySection t={en} language="en" inventory={aFullInventory()} />);

    expect(markup).toContain(attribute(`/assets/${ASSET_A}?lang=en`));
    expect(markup).toContain('LT-000418');
    // The identifier stays visible in full beside the link, never shortened to eight characters.
    expect(markup).toContain(ASSET_A);
  });

  it('reports the total the server counted, not the rows it happened to receive', () => {
    const markup = html(<InventorySection t={en} language="en" inventory={aFullInventory()} />);

    // Two rows, twenty-six assets. A screen counting `items.length` would render `2 / 2`.
    expect(markup).toContain('2 / 26');
  });

  it('says a withheld section was withheld, and an empty one that there is nothing', () => {
    const refused = html(<InventorySection t={en} language="en" inventory={aRefusedInventory()} />);
    const empty = html(<InventorySection t={en} language="en" inventory={anEmptyInventory()} />);

    expect(refused).toContain(en('assets.withheld.assetRead'));
    expect(refused).not.toContain(en('assets.empty.inventory'));
    expect(empty).toContain(en('assets.empty.inventory'));
    expect(empty).not.toContain(en('assets.withheld.assetRead'));
  });

  it('names the grant each refused section needed, rather than repeating one sentence', () => {
    const inventory = aRefusedInventory();
    const sentences = [
      html(<SummarySection t={en} language="en" inventory={inventory} />),
      html(<InventorySection t={en} language="en" inventory={inventory} />),
      html(<CatalogueSection t={en} language="en" inventory={inventory} />),
    ];

    // Three sections, three grants, three different sentences. Rendering the page found this: all
    // three said "This section was withheld", which tells a reader nothing about what they lack.
    expect(sentences[0]).toContain(en('assets.withheld.custodyRead'));
    expect(sentences[1]).toContain(en('assets.withheld.assetRead'));
    expect(sentences[2]).toContain(en('assets.withheld.categoryRead'));
    expect(new Set(sentences.map((s) => s.replace(/<[^>]+>/gu, ''))).size).toBe(3);
  });

  it('withholds one section without withholding its neighbours', () => {
    const inventory = aPartlyWithheldInventory();
    const summary = html(<SummarySection t={en} language="en" inventory={inventory} />);
    const assets = html(<InventorySection t={en} language="en" inventory={inventory} />);

    expect(summary).toContain(en('assets.withheld.custodyRead'));
    expect(assets).toContain('LT-000418');
    expect(assets).not.toContain(en('assets.withheld.assetRead'));
  });

  it('shows the category identifier when the catalogue was not readable', () => {
    const inventory = { ...aFullInventory(), categories: undefined };
    const markup = html(<InventorySection t={en} language="en" inventory={inventory} />);

    // Honest: the screen has an identifier and no name, so it shows the identifier.
    expect(markup).toContain(CATEGORY_PHONE);
  });

  it('translates the closed status vocabulary in both languages', () => {
    const english = html(<InventorySection t={en} language="en" inventory={aFullInventory()} />);
    const arabic = html(<InventorySection t={ar} language="ar" inventory={aFullInventory()} />);

    expect(english).toContain(en('assets.status.under_repair'));
    expect(arabic).toContain(ar('assets.status.under_repair'));
    // The tag is a tenant's own value and is never translated in either direction.
    expect(arabic).toContain('PH-000092');
  });
});

describe('what is outstanding across the tenant', () => {
  it('renders the module figures and never derives one', () => {
    const markup = html(<SummarySection t={en} language="en" inventory={aFullInventory()} />);

    expect(markup).toContain('14');
    expect(markup).toContain('346');
    expect(markup).toContain('2025-09-15');
    // The date every figure was measured against travels with them.
    expect(markup).toContain('2026-08-27');
  });

  it('says nothing is out rather than showing three dashes', () => {
    const markup = html(<SummarySection t={en} language="en" inventory={anEmptyInventory()} />);

    expect(markup).toContain(en('assets.empty.nothingOut'));
    expect(markup).not.toContain(en('assets.label.longestDaysOutstanding'));
  });
});

describe('the tenant catalogue', () => {
  it('keeps the tenant ordering and marks what is no longer in use', () => {
    const markup = html(<CatalogueSection t={en} language="en" inventory={aFullInventory()} />);

    expect(markup.indexOf('laptop')).toBeLessThan(markup.indexOf('phone'));
    expect(markup).toContain(en('assets.active.no'));
  });

  it('names an asset type in the language being read', () => {
    const english = html(<CatalogueSection t={en} language="en" inventory={aFullInventory()} />);
    const arabic = html(<CatalogueSection t={ar} language="ar" inventory={aFullInventory()} />);

    expect(english).toContain('Mobile phone');
    expect(arabic).toContain('هاتف محمول');
  });
});
