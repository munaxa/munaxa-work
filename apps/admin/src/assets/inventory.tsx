import type { ReactNode } from 'react';

import type { AssetsInventory } from './api';
import { categoryAmong } from './api';
import type { Language, Translate } from './locale';
import { nameIn } from './locale';
import {
  AssetsSection,
  Cell,
  Clear,
  Fact,
  Facts,
  Figure,
  Isolated,
  Opens,
  Refused,
  Row,
  Rows,
  Term,
  When,
  Wrote,
  shownOf,
  statusTone,
} from './frame';

/**
 * The inventory screen's three sections, one per permission.
 *
 * Each is its own request behind its own grant, so each can be withheld while its neighbours are
 * not — and each says which grant it needed rather than rendering as an empty table.
 */

interface SectionProps {
  readonly t: Translate;
  readonly language: Language;
  readonly inventory: AssetsInventory;
}

/**
 * What is out across the tenant, as an aggregate.
 *
 * Three published figures and nothing else: `openCount`, `oldestIssuedOn` and
 * `longestDaysOutstanding`, all measured by the module against the `asAt` it echoes. **This is the
 * only tenant-wide custody answer that exists.** The module deliberately publishes no listing of
 * every custody, and the difference between the two is that this view names no identifier at all —
 * not an asset, not a custody, not an employment.
 *
 * `oldestIssuedOn` and `longestDaysOutstanding` are absent when nothing is out, and their absence
 * is the answer rather than a gap, so the section renders the module's own "nothing is out" line
 * instead of three dashes.
 */
export const SummarySection = ({ t, inventory }: SectionProps): ReactNode => {
  const { summary } = inventory;

  if (summary === undefined) {
    return (
      <Refused t={t} title={t('assets.label.outstanding')} reason="assets.withheld.custodyRead" />
    );
  }

  if (summary.openCount === 0) {
    return <Clear t={t} title={t('assets.label.outstanding')} message="assets.empty.nothingOut" />;
  }

  return (
    <AssetsSection title={t('assets.label.outstanding')}>
      <Facts>
        <Fact
          label={t('assets.label.openCount')}
          value={<Figure>{String(summary.openCount)}</Figure>}
        />
        <Fact
          label={t('assets.label.oldestIssuedOn')}
          value={<Wrote>{summary.oldestIssuedOn}</Wrote>}
        />
        <Fact
          label={t('assets.label.longestDaysOutstanding')}
          value={
            summary.longestDaysOutstanding === undefined ? (
              <Wrote>{undefined}</Wrote>
            ) : (
              <Figure>{String(summary.longestDaysOutstanding)}</Figure>
            )
          }
        />
        <Fact label={t('assets.label.asAt')} value={<Isolated>{summary.asAt}</Isolated>} />
      </Facts>
    </AssetsSection>
  );
};

/**
 * The inventory itself.
 *
 * Ordered by asset tag, which is the module's own ordering and the string somebody searches for.
 * The tag is the link, because it is what a person is looking for; the identifier stays beneath it
 * in full, because the tag is a label a tenant chose and the identifier is what the route uses.
 *
 * The category column shows the catalogue's own bilingual name when the catalogue was readable, and
 * the identifier when it was not. Both are honest; a blank would not be.
 */
export const InventorySection = ({ t, language, inventory }: SectionProps): ReactNode => {
  const { assets, categories } = inventory;

  if (assets === undefined) {
    return (
      <Refused t={t} title={t('assets.label.registered')} reason="assets.withheld.assetRead" />
    );
  }

  if (assets.items.length === 0) {
    return <Clear t={t} title={t('assets.label.registered')} message="assets.empty.inventory" />;
  }

  return (
    <AssetsSection title={t('assets.label.registered')} description={shownOf(assets)}>
      <Rows
        headings={[
          t('assets.label.assetTag'),
          t('assets.label.category'),
          t('assets.label.serialNumber'),
          t('assets.label.status'),
          t('assets.label.locationNote'),
        ]}
      >
        {assets.items.map((asset) => {
          const category = categoryAmong(categories, asset.assetCategoryId);

          return (
            <Row key={asset.assetId}>
              <Opens
                href={`/assets/${asset.assetId}?lang=${language}`}
                label={asset.assetTag}
                value={asset.assetId}
              />
              <Cell>
                {category === undefined ? (
                  <Isolated>{asset.assetCategoryId}</Isolated>
                ) : (
                  <Wrote>{nameIn(category.name, language)}</Wrote>
                )}
              </Cell>
              <Cell>
                <Wrote>{asset.serialNumber}</Wrote>
              </Cell>
              <Cell>
                <Term t={t} group="status" value={asset.status} tone={statusTone(asset.status)} />
              </Cell>
              <Cell>
                <Wrote>{asset.locationNote}</Wrote>
              </Cell>
            </Row>
          );
        })}
      </Rows>
    </AssetsSection>
  );
};

/**
 * The tenant's catalogue of asset types.
 *
 * Behind `assets.category.read`, which is a different grant from the inventory: reading the list of
 * kinds a tenant issues is not the same authority as enumerating every laptop it owns, and the
 * module separated them on exactly that reasoning.
 *
 * Ordered `(sequence, code)` by the module. Nothing here reorders it — a catalogue sorted
 * alphabetically is a catalogue whose owner's arrangement has been discarded.
 */
export const CatalogueSection = ({ t, language, inventory }: SectionProps): ReactNode => {
  const { categories } = inventory;

  if (categories === undefined) {
    return (
      <Refused t={t} title={t('assets.label.catalogue')} reason="assets.withheld.categoryRead" />
    );
  }

  if (categories.length === 0) {
    return <Clear t={t} title={t('assets.label.catalogue')} message="assets.empty.catalogue" />;
  }

  return (
    <AssetsSection
      title={t('assets.label.catalogue')}
      description={t('assets.note.catalogueIsTenant')}
    >
      <Rows
        headings={[
          t('assets.label.code'),
          t('assets.label.name'),
          t('assets.label.sequence'),
          t('assets.label.active'),
        ]}
        numeric={[2]}
      >
        {categories.map((category) => (
          <Row key={category.assetCategoryId}>
            <When>{category.code}</When>
            <Cell>
              <Wrote>{nameIn(category.name, language)}</Wrote>
            </Cell>
            <Cell numeric>
              <Figure>{String(category.sequence)}</Figure>
            </Cell>
            <Cell>
              <Term
                t={t}
                group="active"
                value={category.active ? 'yes' : 'no'}
                tone={category.active ? 'success' : 'muted'}
              />
            </Cell>
          </Row>
        ))}
      </Rows>
    </AssetsSection>
  );
};
