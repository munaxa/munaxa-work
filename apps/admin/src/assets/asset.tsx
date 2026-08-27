import type { ReactNode } from 'react';
import type { AssetCustodyView, AssetView, CustodyView } from '@work/assets/contracts';

import { categoryAmong } from './api';
import type { AssetContext } from './api';
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
 * One asset, and everyone who has held it.
 *
 * The asset and its custody are **two reads behind two permissions**. Somebody who may read the
 * inventory can be refused the custody chain, and this screen says so rather than showing an item
 * nobody has ever been issued.
 */

interface AssetProps {
  readonly t: Translate;
  readonly language: Language;
  readonly asset: AssetView;
  readonly context: AssetContext;
}

/**
 * What is recorded about the item itself.
 *
 * `status` is whether it is in service, and the module is emphatic that it never says who is
 * holding it — `issued`, `in_custody` and `returned` are custody facts and a copy here would be a
 * second answer that goes stale. So the status badge sits with the item's own facts and the holder
 * sits in its own section below, which is the shape the contract describes.
 *
 * `locationNote` and `purchaseReference` are free text somebody wrote. Neither is a reference:
 * Organization owns units and no module here owns purchase orders, so both are rendered as the
 * notes they are and neither is linked anywhere.
 */
export const AssetFacts = ({ t, language, asset, context }: AssetProps): ReactNode => {
  const category = categoryAmong(context.categories, asset.assetCategoryId);

  return (
    <Facts>
      <Fact
        label={t('assets.label.category')}
        value={
          category === undefined ? (
            <Isolated>{asset.assetCategoryId}</Isolated>
          ) : (
            <Wrote>{nameIn(category.name, language)}</Wrote>
          )
        }
      />
      <Fact
        label={t('assets.label.status')}
        value={<Term t={t} group="status" value={asset.status} tone={statusTone(asset.status)} />}
      />
      <Fact label={t('assets.label.serialNumber')} value={<Wrote>{asset.serialNumber}</Wrote>} />
      <Fact label={t('assets.label.description')} value={<Wrote>{asset.description}</Wrote>} />
      <Fact label={t('assets.label.locationNote')} value={<Wrote>{asset.locationNote}</Wrote>} />
      <Fact
        label={t('assets.label.purchaseReference')}
        value={<Wrote>{asset.purchaseReference}</Wrote>}
      />
    </Facts>
  );
};

/**
 * Who holds the asset now.
 *
 * `current` is derived from the custody rows and there is at most one — a partial unique index is
 * what makes that true, not a convention. **Its absence is a real answer**: the asset is in nobody's
 * custody. That is why this renders the module's own "held by nobody" line rather than an empty
 * table, and why nothing here reads the first row of the history to fill the gap.
 *
 * `daysOutstanding` is the module's figure, measured against the `asAt` it echoes, and it is
 * elapsed time rather than overdue — no expected return is recorded anywhere in this module, so
 * overdue cannot be computed and is not stated.
 */
export const CurrentCustody = ({
  t,
  language,
  custody,
  asAt,
}: {
  readonly t: Translate;
  readonly language: Language;
  readonly custody: CustodyView | undefined;
  readonly asAt: string;
}): ReactNode => {
  if (custody === undefined) {
    return <Clear t={t} title={t('assets.label.currentHolder')} message="assets.empty.noHolder" />;
  }

  return (
    <AssetsSection title={t('assets.label.currentHolder')}>
      <Facts>
        <Fact
          label={t('assets.label.employment')}
          value={
            <a
              className="font-mono text-xs underline underline-offset-4"
              href={`/employment/${custody.employmentId}?lang=${language}`}
            >
              <Isolated>{custody.employmentId}</Isolated>
            </a>
          }
        />
        <Fact label={t('assets.label.issuedOn')} value={<Isolated>{custody.issuedOn}</Isolated>} />
        <Fact
          label={t('assets.label.daysOutstanding')}
          value={
            custody.daysOutstanding === undefined ? (
              <Wrote>{undefined}</Wrote>
            ) : (
              <Figure>{String(custody.daysOutstanding)}</Figure>
            )
          }
        />
        <Fact
          label={t('assets.label.custodyState')}
          value={<Term t={t} group="custodyState" value={custody.state} tone="warning" />}
        />
        <Fact label={t('assets.label.issueNote')} value={<Wrote>{custody.issueNote}</Wrote>} />
        <Fact label={t('assets.label.asAt')} value={<Isolated>{asAt}</Isolated>} />
      </Facts>
    </AssetsSection>
  );
};

/** A day count the module published, or the dash that says it published none. */
const Days = ({ value }: { readonly value: number | undefined }): ReactNode =>
  value === undefined ? <Wrote>{undefined}</Wrote> : <Figure>{String(value)}</Figure>;

/**
 * One custody in the history.
 *
 * A row carries both day counts and shows whichever the module supplied: `daysOutstanding` while it
 * is open, `daysHeld` once it has come back. Never both, never computed, and never a zero standing
 * in for an absence.
 */
const HistoryRow = ({
  t,
  language,
  custody,
}: {
  readonly t: Translate;
  readonly language: Language;
  readonly custody: CustodyView;
}): ReactNode => (
  <Row>
    <Opens
      href={`/employment/${custody.employmentId}?lang=${language}`}
      label={t('assets.label.employment')}
      value={custody.employmentId}
    />
    <When>{custody.issuedOn}</When>
    <When>{custody.returnedOn}</When>
    <Cell>
      <Term
        t={t}
        group="custodyState"
        value={custody.state}
        tone={custody.state === 'open' ? 'warning' : 'muted'}
      />
    </Cell>
    <Cell numeric>
      <Days value={custody.daysOutstanding} />
    </Cell>
    <Cell numeric>
      <Days value={custody.daysHeld} />
    </Cell>
    <Cell>
      <Wrote>{custody.returnNote}</Wrote>
    </Cell>
  </Row>
);

/**
 * Everyone who has held it, current custody included.
 *
 * `daysHeld` is present only once a custody has come back — a closed fact that does not depend on
 * `asAt` — and `daysOutstanding` only while it is open. Neither is computed here; both are columns
 * the module published, and the row shows whichever one it was given.
 *
 * The employment identifier links to the Employee Record, which is an existing route and an
 * identifier this module already publishes. Nothing new crosses a module boundary to make it work.
 */
export const CustodyHistory = ({
  t,
  language,
  history,
}: {
  readonly t: Translate;
  readonly language: Language;
  readonly history: AssetCustodyView['history'];
}): ReactNode => {
  if (history.items.length === 0) {
    return <Clear t={t} title={t('assets.label.custodyHistory')} message="assets.empty.custody" />;
  }

  return (
    <AssetsSection title={t('assets.label.custodyHistory')} description={shownOf(history)}>
      <Rows
        headings={[
          t('assets.label.employment'),
          t('assets.label.issuedOn'),
          t('assets.label.returnedOn'),
          t('assets.label.custodyState'),
          t('assets.label.daysOutstanding'),
          t('assets.label.daysHeld'),
          t('assets.label.returnNote'),
        ]}
        numeric={[4, 5]}
      >
        {history.items.map((custody) => (
          <HistoryRow key={custody.assetCustodyId} t={t} language={language} custody={custody} />
        ))}
      </Rows>
    </AssetsSection>
  );
};

/**
 * The custody half of the page, or the fact that it was withheld.
 *
 * One refusal covers both the current holder and the history, because both come from the single
 * `GET /assets/:assetId/custody` read behind `assets.custody.read`. Rendering two withheld sections
 * for one refused request would report the same fact twice.
 */
export const CustodySections = ({ t, language, context }: AssetProps): ReactNode => {
  const { custody } = context;

  if (custody === undefined) {
    return <Refused t={t} title={t('assets.label.custody')} reason="assets.withheld.custodyRead" />;
  }

  return (
    <>
      <CurrentCustody t={t} language={language} custody={custody.current} asAt={custody.asAt} />
      <CustodyHistory t={t} language={language} history={custody.history} />
    </>
  );
};

/** Where a reader came from, and the identifier this route was opened by. */
export const AssetIdentity = ({
  t,
  language,
  asset,
}: {
  readonly t: Translate;
  readonly language: Language;
  readonly asset: AssetView;
}): ReactNode => (
  <div className="flex flex-col gap-1">
    <a className="text-sm underline underline-offset-4" href={`/assets?lang=${language}`}>
      {t('assets.label.inventory')}
    </a>
    <span className="font-mono text-xs text-muted-foreground">
      <Isolated>{asset.assetId}</Isolated>
    </span>
  </div>
);
