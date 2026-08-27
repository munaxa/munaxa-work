import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { EmptyState, Page, PageHeader, Stack } from '@munaxa/ui';

import { loadAsset, loadAssetContext } from '../../../assets/api';
import { assetsTranslator, directionOf, isLanguage, type Language } from '../../../assets/locale';
import { Boundaries, Isolated } from '../../../assets/frame';
import { AssetFacts, AssetIdentity, CustodySections } from '../../../assets/asset';

/**
 * One asset, opened by its own identifier, with everyone who has held it.
 *
 * This route consumes `GET /assets/:assetId` and `GET /assets/:assetId/custody` — two of the three
 * Assets reads no screen in this product had ever made. They sit behind **different permissions**,
 * so a caller can open the asset and be refused its custody; that renders as withheld, never as an
 * item nobody has ever been issued.
 *
 * A 404 here means one thing: this tenant holds no asset with this identifier. The module's own
 * words are that "another tenant's identifier answers as not found", so an identifier from
 * somewhere else is indistinguishable from one that never existed and cannot be used as a probe.
 *
 * **The asset tag is the page heading**, because it is the label somebody wrote on the item and the
 * string they came here looking for. The identifier stays on the page, in full, because the tag is
 * a value a tenant chose and the identifier is what the route was opened by.
 *
 * Like the ten detail routes before it, this one renders the correct not-found state at HTTP 200:
 * the shell streams before the page's `await` resolves, so the status is already committed when
 * `notFound()` runs. That is shared infrastructure and a separately tracked issue; this slice
 * inherits it rather than changing it for eleven routes at once.
 */

export const metadata: Metadata = { title: 'Asset' };

interface PageProps {
  readonly params: Promise<{ readonly assetId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/**
 * The four a reader of *this* screen is most likely to assume otherwise about.
 *
 * Different from the inventory's four, because the questions are different: here somebody is
 * looking at one item's history and the plausible wrong assumptions are that a day count means
 * overdue, that an asset can be handed straight from one person to another, that the record is the
 * employee's acknowledgement, and that only one person can hold it at a time — which is true, and
 * worth saying, because the history shows several.
 */
const BOUNDARIES = [
  'assets.note.oneHolder',
  'assets.note.noTransfer',
  'assets.note.noAcknowledgement',
  'assets.note.employmentNotPerson',
];

const AssetPage = async ({ params, searchParams }: PageProps): Promise<ReactNode> => {
  const { assetId } = await params;
  const requested = single((await searchParams)['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = assetsTranslator(language);
  const answer = await loadAsset(assetId);

  if (answer.kind === 'missing') notFound();

  if (answer.kind === 'refused') {
    return (
      <div dir={directionOf(language)} lang={language}>
        <Page width="wide">
          <PageHeader title={t('assets.label.asset')} />
          <EmptyState
            title={t('assets.label.nothingReadable')}
            description={t('assets.withheld.assetRead')}
          />
        </Page>
      </div>
    );
  }

  const asset = answer.value;
  const context = await loadAssetContext(assetId);
  const props = { t, language, asset, context };

  return (
    <div dir={directionOf(language)} lang={language}>
      <Page width="wide">
        <PageHeader
          title={<Isolated>{asset.assetTag}</Isolated>}
          description={t('assets.note.tagIsIdentity')}
        />

        <AssetIdentity t={t} language={language} asset={asset} />

        <Stack gap={8}>
          <AssetFacts {...props} />
          <CustodySections {...props} />
        </Stack>

        <Boundaries t={t} keys={BOUNDARIES} />
      </Page>
    </div>
  );
};

export default AssetPage;
