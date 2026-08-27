import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Page, PageHeader, Stack } from '@munaxa/ui';

import { loadInventory } from '../../assets/api';
import { assetsTranslator, directionOf, isLanguage, type Language } from '../../assets/locale';
import { Boundaries } from '../../assets/frame';
import { CatalogueSection, InventorySection, SummarySection } from '../../assets/inventory';

/**
 * The asset inventory, and what is out across the tenant.
 *
 * Three reads behind three separate grants: `assets.custody.read` answers the outstanding summary,
 * `assets.asset.read` the inventory, `assets.category.read` the catalogue. A caller may hold any
 * subset, and a section they may not read says so rather than rendering as an empty table — because
 * an empty inventory reads as "this company owns nothing", which is a statement this screen must
 * never make on a refusal.
 *
 * **There is no custody register here, and its absence is deliberate.** `GET /assets/custody`
 * requires an `employmentId`; the module publishes no read that enumerates every custody in the
 * tenant, and assembling one from the inventory would be inventing a listing the domain declined to
 * publish. What one employment holds already appears on the Employee Record. What one *asset* has
 * been through is the detail route this screen opens.
 *
 * The summary is the one tenant-wide custody answer that exists, and it is aggregate by
 * construction: a count and two dates, naming no asset, no custody and no employment.
 */

export const metadata: Metadata = { title: 'Assets' };

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/**
 * Composed from the module's own notes, not from sentences written here.
 *
 * Assets ships twenty-two of them in both languages, each stating in the customer's words something
 * this release does not do. Four are true of this screen and are the four a reader is most likely
 * to assume otherwise about: that a status says who holds an item, that this system knows what
 * anything cost, that custody names a person, and that the catalogue is theirs rather than ours.
 */
const BOUNDARIES = [
  'assets.note.statusIsService',
  'assets.note.noValuation',
  'assets.note.employmentNotPerson',
  'assets.note.catalogueIsTenant',
];

const AssetsPage = async ({ searchParams }: PageProps): Promise<ReactNode> => {
  const requested = single((await searchParams)['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = assetsTranslator(language);
  const inventory = await loadInventory();
  const props = { t, language, inventory };

  return (
    <div dir={directionOf(language)} lang={language}>
      <Page width="wide">
        <PageHeader
          title={t('assets.label.inventory')}
          description={t('admin.notice.eachSectionIsItsOwnPermission')}
        />

        <Stack gap={8}>
          <SummarySection {...props} />
          <InventorySection {...props} />
          <CatalogueSection {...props} />
        </Stack>

        <Boundaries t={t} keys={BOUNDARIES} />
      </Page>
    </div>
  );
};

export default AssetsPage;
