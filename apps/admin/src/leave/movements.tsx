import type { ReactNode } from 'react';
import type { EntitlementView, LeaveAdjustmentView, LedgerEntryView } from '@work/leave/contracts';

import {
  Cell,
  Clear,
  Duration,
  Isolated,
  LeaveSection,
  Named,
  Note,
  Refused,
  Reference,
  Row,
  Rows,
  Term,
  Wrote,
  When,
  shownOf,
  type LeaveProps,
} from './frame';
import { DASH, day, instant, minutes, reference } from './exact';
import { LEDGER_TONE } from './tones';
import type { StandingProps } from './standing';
import type { Listing } from './api';

/**
 * The three sections that say where a balance came from: what moved it, what was granted, and what
 * somebody changed by hand.
 *
 * Apart from `standing.tsx` because a screen file's budget is four hundred lines and these are
 * three tables rather than the page's own composition — and because the ledger is the section this
 * whole slice exists for, which is easier to review on its own.
 *
 * **Two permissions across these three.** The ledger answers to `leave.balance.read`; entitlements
 * and adjustments answer to `leave.read`. A caller holding one and not the other sees part of this
 * page, and each section says which of them happened to it rather than rendering an empty table.
 */

const LedgerRow = ({
  t,
  language,
  entry,
}: StandingProps & { readonly entry: LedgerEntryView }): ReactNode => (
  <Row>
    <When>
      <Isolated>{day(entry.effectiveOn)}</Isolated>
    </When>
    <Cell>
      <Term t={t} group="kind" value={entry.kind} tone={LEDGER_TONE[entry.kind]} />
    </Cell>
    <Cell numeric>
      <Duration>{minutes(t, entry.balanceBeforeMinutes)}</Duration>
    </Cell>
    <Cell numeric>
      <Duration>{minutes(t, entry.minutes)}</Duration>
    </Cell>
    <Cell numeric>
      <Duration>{minutes(t, entry.balanceAfterMinutes)}</Duration>
    </Cell>
    <Cell>
      <Term t={t} group="source" value={entry.sourceKind} tone="muted" />
    </Cell>
    <Cell>
      <Reference value={reference(entry.sourceId)} />
    </Cell>
    <Cell>
      <Reference value={reference(entry.reversesEntryId)} />
    </Cell>
    <When>
      <Isolated>{instant(entry.recordedAt, language)}</Isolated>
    </When>
  </Row>
);

/**
 * Why the balance is this number.
 *
 * Three of these columns come straight off the contract and are the reason this section exists:
 * the balance before the movement, the movement, and the balance after it. Nothing is added up
 * here — the server already did, once, when it wrote the entry.
 */
export const LedgerSection = ({
  t,
  language,
  ledger,
}: StandingProps & { readonly ledger: Listing<LedgerEntryView> | undefined }): ReactNode => {
  const title = t('leave.label.ledger');

  if (ledger === undefined) {
    return <Refused t={t} title={title} reason="leave.notice.balanceIsOwnPermission" />;
  }
  if (ledger.items.length === 0) {
    return <Clear t={t} title={title} message="leave.label.noLedger" />;
  }

  return (
    <LeaveSection title={title} description={shownOf(ledger)}>
      <Rows
        headings={[
          t('leave.label.effectiveOn'),
          t('leave.label.kind'),
          t('leave.label.balanceBefore'),
          t('leave.label.movement'),
          t('leave.label.balanceAfter'),
          t('leave.label.source'),
          t('leave.label.sourceReference'),
          t('leave.label.reverses'),
          t('leave.label.recordedAt'),
        ]}
        numeric={[2, 3, 4]}
      >
        {ledger.items.map((entry) => (
          <LedgerRow key={entry.entryId} t={t} language={language} entry={entry} />
        ))}
      </Rows>
      <Note t={t} message="leave.notice.minutesAsPublished" />
    </LeaveSection>
  );
};

export const EntitlementsSection = ({
  t,
  entitlements,
  names,
}: LeaveProps & {
  readonly entitlements: Listing<EntitlementView> | undefined;
  readonly names: ReadonlyMap<string, string>;
}): ReactNode => {
  const title = t('leave.label.entitlements');

  if (entitlements === undefined) return <Refused t={t} title={title} />;
  if (entitlements.items.length === 0) {
    return <Clear t={t} title={title} message="leave.label.noEntitlements" />;
  }

  return (
    <LeaveSection title={title} description={shownOf(entitlements)}>
      <Rows
        headings={[
          t('leave.label.leaveType'),
          t('leave.label.leaveYear'),
          t('leave.label.granted'),
          t('leave.label.source'),
          t('leave.label.reason'),
        ]}
        numeric={[2]}
      >
        {entitlements.items.map((entitlement) => (
          <Row key={entitlement.entitlementId}>
            <Named
              name={names.get(entitlement.leaveTypeId)}
              value={reference(entitlement.leaveTypeId)}
            />
            <When>
              <Isolated>{day(entitlement.leaveYearStart)}</Isolated>
            </When>
            <Cell numeric>
              <Duration>{minutes(t, entitlement.grantedMinutes)}</Duration>
            </Cell>
            <Cell>
              <Term t={t} group="grant" value={entitlement.source} tone="muted" />
            </Cell>
            <Cell>
              <Reference value={reference(entitlement.reasonCode)} />
            </Cell>
          </Row>
        ))}
      </Rows>
    </LeaveSection>
  );
};

/** The movements somebody made by hand, with the words they wrote for doing it. */
export const AdjustmentsSection = ({
  t,
  language,
  adjustments,
  names,
}: StandingProps & {
  readonly adjustments: Listing<LeaveAdjustmentView> | undefined;
  readonly names: ReadonlyMap<string, string>;
}): ReactNode => {
  const title = t('leave.label.adjustments');

  if (adjustments === undefined) return <Refused t={t} title={title} />;
  if (adjustments.items.length === 0) {
    return <Clear t={t} title={title} message="leave.label.noAdjustments" />;
  }

  return (
    <LeaveSection title={title} description={shownOf(adjustments)}>
      <Rows
        headings={[
          t('leave.label.effectiveOn'),
          t('leave.label.leaveType'),
          t('leave.label.movement'),
          t('leave.label.reason'),
          t('leave.label.note'),
          t('leave.label.adjustedBy'),
          t('leave.label.recordedAt'),
        ]}
        numeric={[2]}
      >
        {adjustments.items.map((adjustment) => (
          <Row key={adjustment.adjustmentId}>
            <When>
              <Isolated>{day(adjustment.effectiveOn)}</Isolated>
            </When>
            <Named
              name={names.get(adjustment.leaveTypeId)}
              value={reference(adjustment.leaveTypeId)}
            />
            <Cell numeric>
              <Duration>{minutes(t, adjustment.minutes)}</Duration>
            </Cell>
            <Cell>
              <Reference value={reference(adjustment.reasonCode)} />
            </Cell>
            <Cell>
              <Wrote>{adjustment.note || DASH}</Wrote>
            </Cell>
            <Cell>
              <Reference value={reference(adjustment.adjustedBy)} />
            </Cell>
            <When>
              <Isolated>{instant(adjustment.adjustedAt, language)}</Isolated>
            </When>
          </Row>
        ))}
      </Rows>
    </LeaveSection>
  );
};
